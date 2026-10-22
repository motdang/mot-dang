/* The fleet search's query language, run under plain node.
 *
 * publish/fleetsearch.js turns what a reader typed into an FTS5 MATCH string.
 * Every rule about what a query MEANS — which words are required, what a sign
 * does, how NEAR and NOT nest, how a Thai run becomes a phrase — lives there,
 * and none of it needs Cloudflare to check.
 *
 *     node tests/test_fleetsearch.js            # the cases
 *     node tests/test_fleetsearch.js --dump     # {query: [match…]} for the Python side
 *
 * tests/test_fleetsearch.py takes the --dump and runs every MATCH string
 * against the local twin of the index, so a string that parses here and
 * breaks in SQLite is still caught. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fs = await import(join(ROOT, "publish/fleetsearch.js"));

/* A stand-in segmenter with the three words the cases need; the real one is a
 * dictionary of 30,000 and lives in docs/data/search_segdict.txt. */
const seg = { split: (run) => {
  const out = [];
  let s = run;
  for (const w of ["ร้านกาแฟ", "นิมมาน", "ตอกเส้น", "เชียงใหม่"]) {
    const i = s.indexOf(w);
    if (i >= 0) { if (i) out.push(s.slice(0, i)); out.push(w); s = s.slice(i + w.length); }
  }
  if (s) out.push(s);
  return out;
} };
const thes = { expand: (w) => (w === "toksen" ? ["toksen", "tok sen", "ตอกเส้น"] : [w]) };

let failures = 0;
function t(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"}\n       got  ${JSON.stringify(a)}\n       want ${JSON.stringify(b)}`);
}
function ok(c, what) { if (!c) throw new Error(what || "expected true"); }
const steps = (q, adv) => (adv ? fs.planBoolean(q, seg) : fs.plan(q, seg, thes)).steps.map((s) => s.match);

const CASES = [
  // simple: every word, then any word, then synonyms
  ["cafe nimman", false, ['"cafe" AND "nimman"', '("cafe" OR "nimman")']],
  ["+vegan cafe nimman -spa", false,
   ['("vegan" AND "cafe" AND "nimman") NOT "spa"', '("vegan" AND ("cafe" OR "nimman")) NOT "spa"']],
  ['"tok sen" old city', false, ['"tok sen" AND "old" AND "city"', '("tok sen" OR "old" OR "city")']],
  ["dermat*", false, ['"dermat" *']],
  ["title:ยันต์", false, ['title_s : "ยันต์"']],
  ["url:cm/p massage", false, ['url_s : "cm/p" AND "massage"', '(url_s : "cm/p" OR "massage")']],
  // other spellings join the FIRST step, not only the last fallback
  ["toksen", false, ['("toksen" OR "tok sen" OR "ตอกเส้น")']],
  ["toksen massage", false, ['("toksen" OR "tok sen" OR "ตอกเส้น") AND "massage"',
                             '(("toksen" OR "tok sen" OR "ตอกเส้น") OR "massage")']],
  // a Thai run is one phrase of dictionary words
  ["ร้านกาแฟนิมมาน", false, ['"ร้านกาแฟ นิมมาน"', '("ร้านกาแฟ" AND "นิมมาน")']],
  ["title:ร้านกาแฟนิมมาน cafe", false,
   ['title_s : "ร้านกาแฟ นิมมาน" AND "cafe"', '(title_s : "ร้านกาแฟ" AND title_s : "นิมมาน") AND "cafe"',
    '(title_s : "ร้านกาแฟ นิมมาน" OR "cafe")']],
  ["mae hong son", false, ['"mae" AND "hong" AND "son"', '("mae" OR "hong" OR "son")']],
  ["ตอกเส้น เชียงใหม่", false, ['"ตอกเส้น" AND "เชียงใหม่"', '("ตอกเส้น" OR "เชียงใหม่")']],
  // punctuation-only terms vanish; a query of nothing plans nothing
  ["-- ***", false, []],
  ['a "b c" d', false, ['"a" AND "b c" AND "d"', '("a" OR "b c" OR "d")']],
  ['say "hi"', false, ['"say" AND "hi"', '("say" OR "hi")']],
  // upper-case operators switch the simple box to boolean
  ["vegan OR เจ", false, ['("vegan" OR "เจ")']],
  ["massage NOT spa", false, ['("massage" NOT "spa")']],
  // boolean
  ["(vegan OR เจ) AND cafe NOT spa", true, ['(((("vegan" OR "เจ")) AND "cafe") NOT "spa")']],
  ["elephant NEAR sanctuary AND NOT riding", true, ['(NEAR("elephant" "sanctuary", 10) NOT "riding")']],
  ["a near b near c", true, ['NEAR("a" "b" "c", 10)']],
  ["a b c", true, ['(("a" AND "b") AND "c")']],
  // NOT binds tightest, then AND, then OR — FTS5's own order
  ["a & b | c ! d", true, ['(("a" AND "b") OR ("c" NOT "d"))']],
  ["a AND", true, ['"a"']],
  ["(a OR b", true, ['(("a" OR "b"))']],
  ["a b) c", true, ['(("a" AND "b") AND "c")']],
  ['title:"tok sen" AND site:wichaa.net', true, ['title_s : "tok sen"']],
  ["dermat* OR skin", true, ['("dermat" * OR "skin")']],
  ["a -b", true, ['("a" NOT "b")']],
];

for (const [q, adv, want] of CASES) {
  t(`${adv ? "boolean" : "simple "}  ${q}`, () => eq(JSON.stringify(steps(q, adv)), JSON.stringify(want), "steps"));
}

t("site: is a filter, not a word", () => {
  const p = fs.plan("massage site:wichaa.net site:motdang", seg, thes);
  eq(JSON.stringify(p.sites), '["wichaa.net","motdang"]');
  eq(p.steps[0].match, '"massage"');
});
t("a lone NOT is refused, and said", () => {
  const p = fs.planBoolean("NOT x", seg);
  eq(p.error, "NOT needs a word before it");
});
t("NEAR over a group is refused, and said", () => {
  const p = fs.planBoolean("(a OR b) NEAR c", seg);
  eq(p.error, "NEAR joins words, not groups or fields");
});
t("quotes inside a phrase are doubled", () => {
  eq(fs.phrase('say "hi"', null, false), '"say ""hi"""');
});
t("the query is capped at 300 characters", () => {
  const long = "x ".repeat(400);
  const n = fs.plan(long, null, null).steps[0].match.split(" AND ").length;
  if (n > 150) throw new Error(`${n} terms survived the cap`);
});
t("a site narrows inside the match; only a date joins the keys", () => {
  const plain = fs.sql('"massage"', { n: 10, offset: 0 });
  eq(plain.text.includes("JOIN keys q"), false, "no join");
  eq(plain.binds[0], '"massage"');
  const s = fs.sql('"massage"', { sites: ["wichaa.net", "hand-poke"], from: "2026-01-01", n: 10, offset: 0 });
  eq(s.text.includes("JOIN keys q"), true, "date joins");
  eq(JSON.stringify(s.binds), '["(\\"massage\\") AND (site_s : \\"wichaa.net\\" OR site_s : \\"hand-poke\\")","2026-01-01"]');
});

t("words-in wraps the whole expression, and stands down on a reader's own field", () => {
  eq(fs.narrow('("a" AND "b")', { in: "title" }), 'title_s : (("a" AND "b"))');
  eq(fs.narrow('("a" AND "b")', { in: "title", fields: true }), '("a" AND "b")');
  eq(fs.narrow('"a"', { in: "all" }), '"a"');
  eq(fs.narrow('"a"', { in: "url", sites: ["wichaa"] }), '(url_s : ("a")) AND (site_s : "wichaa")');
});

t("a reader's own title:/url: is reported, site: is not", () => {
  eq(fs.plan("title:yant cafe", null, null).fields, true);
  eq(fs.plan("cafe site:wichaa.net", null, null).fields, false);
  eq(fs.planBoolean("url:cm AND x", null).fields, true);
});

t("the fat rows are read only for the page being shown", () => {
  for (const o of [{ n: 10, offset: 0 }, { sort: "new", n: 10, offset: 0 }]) {
    const text = fs.sql('"a"', o).text;
    const inner = text.slice(text.indexOf("FROM (") + 6, text.lastIndexOf(") "));
    eq(/JOIN pages/.test(inner), false, "pages is joined before the cut: " + inner.slice(0, 120));
  }
});

t("relevance pages inside the query; another sort orders the reachable window", () => {
  const rank = fs.sql('"a"', { n: 10, offset: 30 });
  eq(/LIMIT 10 OFFSET 30/.test(rank.text), true, "rank pages in the inner query");
  // best match is read inside the ranked window, weighed by events held there
  eq(/ORDER BY f.sc, f.id$/.test(rank.text), true, "rank order");
  eq(/min\(k\.evc, 10\)/.test(rank.text), true, "events weigh the row");
  eq(/ORDER BY f.rank$/.test(fs.sql('"a"', { n: 10, offset: 200 }).text), true, "past the window, bm25 alone");
  const dated = fs.sql('"a"', { sort: "new", n: 20, offset: 40 });
  eq(/ORDER BY rank LIMIT 1000/.test(dated.text), true, "the window is 1000 by rank");
  eq(/ORDER BY s.lastmod DESC, s.id LIMIT 20 OFFSET 40/.test(dated.text), true, "then by date");
  eq(/ORDER BY k.lastmod DESC, p.id$/.test(dated.text), true, "and the ten come back in that order");
  eq(/COLLATE NOCASE/.test(fs.sql('"a"', { sort: "az", n: 10, offset: 0 }).text), true, "az collates");
});

t("the site facet drops the site filter; the date facet drops the dates", () => {
  const sf = fs.siteFacetSql('"a"', { sites: ["wichaa"], from: "2026-01-01", in: "title" });
  eq(sf.binds[0], 'title_s : ("a")', "site filter is out, words-in stays");
  eq(JSON.stringify(sf.binds), '["title_s : (\\"a\\")","2026-01-01"]');
  const df = fs.dateFacetSql('"a"', { sites: ["wichaa"], from: "2026-01-01" }, new Date("2026-09-21T00:00:00Z"));
  eq(df.binds[3], '("a") AND (site_s : "wichaa")', "site filter stays, dates are out");
  eq(df.binds[0], "2026-09-14");
  eq(df.binds[2], "2025-09-21");
});

t("type, section and has filters join the keys; open-now is a list of schedule ids", () => {
  const o = { n: 10, offset: 0, kind: "place", sec: "เชียงใหม่ › ร้านอาหาร-ของกิน",
              has: ["photo", "toilet", "events", "open"], today: "2026-09-23", open: [3, 7] };
  const s = fs.sql('"a"', o);
  eq(s.text.includes("JOIN keys q"), true, "keys joined");
  eq(s.text.includes("q.kind = ?") && s.text.includes("q.sec = ?"), true, "kind and sec bound");
  eq(s.text.includes("(q.has & 5) = 5"), true, "photo + toilet as one mask");
  eq(s.text.includes("q.evu >= ?"), true, "events still to come");
  eq(s.text.includes("q.sk IN (3,7)"), true, "open now");
  eq(JSON.stringify(s.binds), '["\\"a\\"","place","เชียงใหม่ › ร้านอาหาร-ของกิน","2026-09-23"]');
  eq(fs.sql('"a"', { ...o, has: ["open"], open: [] }).text.includes(" AND 0"), true, "nothing open is nothing");
});

t("the facet query leaves out its own dimensions and keeps the has-filters", () => {
  const f = fs.facetSql('"a"', { sites: ["wichaa"], qsites: [], kind: "place", sec: "x", has: ["photo"],
                                 from: "2026-01-01", today: "2026-09-23", open: [1] }, new Date("2026-09-23T00:00:00Z"));
  eq(f.text.includes("q.kind = ?") || f.text.includes("q.sec = ?"), false, "type and section counted, not filtered");
  eq(f.text.includes("(q.has & 1) = 1"), true, "has filter applies");
  eq(f.text.includes("q.lastmod >= '2026-01-01'"), true, "the date filter rides inside the sums");
  eq(f.binds[3], '"a"', "site filter out of the match");
  eq(f.binds.length, 4, "no stray binds");
  eq(f.binds[0], "2026-09-16");
});

t("facet groups add up the way the bar reads them", () => {
  const g = [
    { site: "motdang", host: "motdang.net", kind: "place", sec: "A", n: 5, nd: 5, d7: 1, d30: 2, d365: 5, h_photo: 1, h_toilet: 2 },
    { site: "motdang", host: "motdang.net", kind: "list", sec: "A", n: 3, nd: 3, d7: 0, d30: 0, d365: 3, h_photo: 0 },
    { site: "wichaa", host: "wichaa.net", kind: "page", sec: "B", n: 4, nd: 4, d7: 4, d30: 4, d365: 4, h_photo: 4 },
  ];
  const f = fs.facetsFrom(g, { kind: "place" });
  eq(JSON.stringify(f.kinds), '{"place":5,"page":4,"list":3}', "kinds ignore the kind filter");
  eq(JSON.stringify(f.sites), '[{"site":"motdang","host":"motdang.net","n":5}]', "sites honour it");
  eq(f.has.photo, 1); eq(f.has.toilet, 2); eq(f.total, 5); eq(f.dates.d7 === undefined, true);
  eq(f.dates["7d"], 1);
  const s = fs.facetsFrom(g, { site: "motdang" });
  eq(JSON.stringify(s.secs), '[["A",8]]', "sections inside the site");
});

t("an event's next day: a date, or the next matching weekday until it stops", () => {
  eq(fs.nextDate({ d: "2026-09-30" }, "2026-09-23"), "2026-09-30");
  eq(fs.nextDate({ d: "2026-09-01" }, "2026-09-23"), "", "a past one-off is gone");
  eq(fs.nextDate({ d: "2026-09-12", w: [5] }, "2026-09-23"), "2026-09-26", "Saturdays");
  eq(fs.nextDate({ d: "2026-09-12", w: [2] }, "2026-09-23"), "2026-09-23", "today is a Wednesday");
  eq(fs.nextDate({ d: "2026-09-12", w: [5], u: "2026-09-25" }, "2026-09-23"), "", "stopped before the next one");
});

t("open now: minute of the week in Bangkok, intervals that run past Sunday night", () => {
  const w = fs.bangkok(new Date("2026-09-23T03:00:00Z"));          // Wed 10:00 in Bangkok
  eq(w.today, "2026-09-23"); eq(w.minute, 2 * 1440 + 600);
  eq(fs.openAt([[2 * 1440 + 480, 2 * 1440 + 1080]], w.minute), true);
  eq(fs.openAt([[6 * 1440 + 1200, 10080 + 120]], 60), true, "Sunday 20:00 to Monday 02:00, asked at Mon 01:00");
  eq(fs.openAt([[0, 60]], 61), false);
  eq(JSON.stringify(fs.openIds(new Map([[0, [[0, 100]]], [1, [[200, 300]]]]), 50)), "[0]");
});

t("the map cell puts the pin in its middle half, the same way thumbs.py does", () => {
  for (const [lat, lon] of [[18.8000906, 99.0183907], [18.7876, 98.9931], [19.9105, 99.8406]]) {
    const n = 2 ** 16;
    const X = ((lon + 180) / 360) * n;
    const Y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const hx = X - Math.floor(X) >= 0.5 ? Math.floor(X) : Math.floor(X) - 1;
    const hy = Y - Math.floor(Y) >= 0.5 ? Math.floor(Y) : Math.floor(Y) - 1;
    const [x, y] = fs.cellPos(lat, lon, hx, hy);
    eq(x >= 25 && x < 75 && y >= 25 && y < 75, true, `pin at ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  eq(fs.cellPos(18.8000906, 99.0183907, 50793, 29281).map((v) => v.toFixed(1)).join(","), "37.4,71.4",
     "the cell drawn for Wawee Coffee, Wat Ket");
});

t("the rich line names what the listing holds, and a habit as a habit", () => {
  const aux = { scheds: new Map([[0, [[2 * 1440 + 480, 2 * 1440 + 1080]]]]) };
  const when = { today: "2026-09-23", minute: 2 * 1440 + 600 };
  const row = { has: 2 | 16, sk: 0, rich: JSON.stringify({ ways: ["phone", "line", "web"], toilet: ["r", "มีห้องน้ำ", "toilet"],
    ev: [{ d: "2026-09-12", w: [5], t: "Nomad Dinner" }], fac: [["wifi", "📶", "ไวไฟ", "Wi-Fi"], ["toilethere", "🚻", "x", "y"]] }) };
  const line = fs.richLine(row, aux, when);
  for (const want of ["ติดต่อได้ 3 ทาง · 3 ways to reach", '<a href="/toilets.html">🚻 มีห้องน้ำ · toilet</a>', "Nomad Dinner · 26 ก.ย. · 26 Sep",
                      "🟢 เปิดอยู่ · open now", "📶"]) {
    eq(line.includes(want), true, want);
  }
  eq(line.includes("🚻</span>") || (line.match(/🚻/g) || []).length > 1, false, "a toilet facet is not shown twice");
  const habit = fs.richLine({ rich: JSON.stringify({ toilet: ["h", "ปกติมีห้องน้ำ", "usually a toilet"] }) }, aux, when);
  eq(habit.includes("ปกติมีห้องน้ำ · usually a toilet"), true, habit);
  const near = fs.richLine({ rich: JSON.stringify({ toilet: ["n", "วัดเกต", 150] }) }, aux, when);
  eq(near.includes("🚻 ห้องน้ำ 150 ม. · toilet 150 m") && near.includes('title="วัดเกต"'), true, near);
  eq(fs.richLine({ has: 16, sk: 0, rich: "{}" }, aux, { ...when, minute: 0 }).includes("hours listed"), true,
     "closed is not said; hours are");
  eq(fs.richLine({ rich: null }, aux, when), "");
});

t("a photo beats a map; a map carries its pin", () => {
  eq(/tiles\/find\/p\/abc\.webp/.test(fs.thumbHtml({ url: "u", thumb: "p/abc", lat: 18.8, lon: 99 })), true);
  const m = fs.thumbHtml({ url: "u", thumb: "g/50793_29281", lat: 18.8000906, lon: 99.0183907 });
  eq(/tiles\/find\/g\/50793_29281\.webp/.test(m) && /left:37\.4%;top:71\.4%/.test(m), true, m);
  eq(fs.thumbHtml({ url: "u", thumb: "", lat: 18.8, lon: 99 }), "");
});

t("a site from the register answers by name, by its words, and in Thai", () => {
  const rows = [
    { u: "https://motdang.net/sites/many-hands/", th: "หลายมือ", en: "Many Hands", lt: "แม่บ้าน คนสวน", le: "housekeepers", w: ["maid", "home help"] },
    { u: "https://motdang.net/sala/", th: "ศาลาพักบอท", en: "Dharma Bots", lt: "", le: "bots talk", w: [] },
    { u: "https://motdang.net/horoscope.html", th: "ดวง", en: "Horoscope", lt: "", le: "planet, posture", w: [] },
  ];
  const en = (q) => fs.siteMatch(q, rows).map((r) => r.en).join("|");
  eq(en("many hands"), "Many Hands");
  eq(en("maid"), "Many Hands");
  eq(en("แม่บ้าน"), "Many Hands");
  eq(en("dharma bots"), "Dharma Bots");
  eq(en("the"), "", "a stopword alone matches nothing");
  eq(en("plan"), "", "a short word does not match inside planet");
  eq(en("noodle"), "");
});

/* ---- 2026-10-03: spellings, intent, NOT alone, shelves, quality tags ---- */

const SC = (await import(join(ROOT, "publish/searchcore.js"))).default;
const realThes = new SC.Thesaurus([["kao soi", "khao soi", "khaosoi", "kow soi", "ข้าวซอย"],
                                   ["lane", "road", "sauy", "soi", "soy", "street", "ซอย", "ถนน", "ทาง"]]);
const first = (q, extra) => fs.planSimple(q, null, realThes, extra).steps[0].match;

t("every spelling of khao soi widens the first step to the same set", () => {
  for (const q of ["khao soi", "kao soi", "khaosoi", "khao soy", "kaosoi", "kow soy", "ข้าวซอย"]) {
    const m = first(q);
    for (const v of ['"khao soi"', '"kao soi"', '"khaosoi"', '"ข้าวซอย"']) {
      if (!m.includes(v) && !(q === v.slice(1, -1))) throw new Error(`${q}: ${v} missing from ${m}`);
    }
  }
  eq(first("khao soi"), '(("khao" AND "soi") OR "kao soi" OR "khaosoi" OR "kow soi" OR "ข้าวซอย")');
});
t("a mined blob larger than eight is not a synonym: soi stays soi", () => {
  eq(first("soi 5"), '"soi" AND "5"');
});
t("a word on tens of thousands of pages is not widened", () => {
  eq(first("ข้าวซอย", { common: new Set(["ข้าวซอย"]) }), '"ข้าวซอย"');
});
t("near spellings: the fix joins the word and the page says which", () => {
  const p = fs.planSimple("massge", null, null, { fix: { massge: ["massage"] } });
  eq(p.steps[0].match, '("massge" OR "massage")');
  eq(/near spellings — closest first: massge → massage/.test(p.steps[0].note), true, "note " + p.steps[0].note);
});
t("intent: near me, open now and a price leave the match", () => {
  const l = (q) => { const x = fs.liftIntent(q); return [x.q, x.near, x.open, x.price].join("|"); };
  eq(l("khao soi near me"), "khao soi|true|false|");
  eq(l("hospital nearby"), "hospital|true|false|");
  eq(l("cheap massage"), "massage|false|false|low");
  eq(l("massage open now"), "massage|false|true|");
  eq(l("ข้าวซอยใกล้ฉัน"), "ข้าวซอย|true|false|");
  eq(l("นวด แถวนี้"), "นวด|true|false|");
  eq(l("นวดราคาถูก"), "นวด|false|false|low");
  eq(l("ถูกต้อง"), "ถูกต้อง|false|false|", "a word that starts with ถูก is not cheap");
  eq(l('"near me"'), '"near me"|false|false|', "a quoted phrase is left alone");
  eq(l("elephant NEAR sanctuary"), "elephant NEAR sanctuary|false|false|", "boolean NEAR is not intent");
});
t("NOT with nothing before it: nothing is searched, and the word is named", () => {
  const p = fs.planBoolean("NOT khao", null);
  eq(p.steps.length, 0, "no step");
  eq(p.empty, true);
  eq(JSON.stringify(p.negOnly), JSON.stringify(['"khao"']));
  eq(fs.planBoolean("NOT khao soi", null).steps[0].match, '("soi" NOT "khao")', "held until a word to keep");
  const s = fs.planSimple("-khao", null, null);
  eq(s.empty, true); eq(JSON.stringify(s.negOnly), '["khao"]');
});
t("a query of signs alone plans nothing", () => {
  for (const q of ['"', "-", "*", "+", "title:", "- * +", "−"]) eq(fs.plan(q, null, null).empty, true, q);
});
t("a register name the dictionary would split is asked for whole", () => {
  const seg2 = { split: (r) => (r === "รังมด" ? ["รัง", "มด"] : [r]) };
  const p = fs.planSimple("รังมด", seg2, null, { keep: new Set(["รังมด"]) });
  eq(p.steps[0].match, '("รังมด" OR title_s : "รัง มด")');
  eq(p.steps.length, 1, "no words-split step");
  eq(fs.planSimple("รังมด", seg2, null).steps[0].match, '"รัง มด"', "not in the register: split as before");
});
t("record-quality tag pages leave the match the handler sends", () => {
  const s = fs.sql('"massage"', { n: 10, offset: 0, drop: true });
  eq(s.binds[0], '("massage")' + fs.DROP);
  for (const w of ['"tag has"', '"tag multi source"', '"tag stub"', '"tag no contact"']) eq(fs.DROP.includes(w), true, w);
  const f = fs.facetSql('"a"', { drop: true, today: "2026-10-03" }, new Date("2026-10-03T00:00:00Z"));
  eq(f.binds[3].endsWith(fs.DROP), true, "the counts leave them out too");
});
t("best match reads the title from keys, and blends distance in", () => {
  const s = fs.sql('"a"', { n: 10, offset: 0, names: ["khao soi"], pin: { lat: 18.79, lon: 98.98 } });
  eq(/title_s AS ts/.test(s.text), false, "fts.title_s read inside the window");
  eq(/lower\(k\.title\)/.test(s.text), true, "keys.title");
  eq(/k\.lat IS NULL THEN 1\.0/.test(s.text), true, "an unpinned row keeps its weight");
  eq(/LIMIT 200\)/.test(s.text), true, "the window is 200");
  eq(s.binds[0], " · khao soi · "); eq(s.binds[1], " · khao soi"); eq(s.binds[2], "khao soi"); eq(s.binds[3], "khao soi"); eq(s.binds[4], '"a"');
  eq(/LIMIT 10 OFFSET 200/.test(fs.sql('"a"', { n: 10, offset: 200, names: ["x"] }).text), true, "past the window: plain rank");
});
t("distance never sinks a named page, and a network guess keeps a floor (Tulou, 2026-10-20)", () => {
  const ex = fs.sql('"tulou"', { n: 10, offset: 0, names: ["tulou"], pin: { lat: 18.79, lon: 98.98, exact: true } });
  eq(/THEN max\(1\.0, 1\.6 \//.test(ex.text), true, "a title with the words keeps at least 1.0");
  eq(/max\(0\.5,/.test(ex.text), false, "an exact position has no floor");
  const gs = fs.sql('"khao soi"', { n: 10, offset: 0, pin: { lat: 19.685, lon: 100.195, exact: false } });
  eq(/max\(0\.5, 1\.6 \//.test(gs.text), true, "a guess keeps half an unpinned row");
  eq(gs.binds.length, ex.binds.length - 4, "binds line up");
});
t("a title piece that starts with the words ranks over one that only carries them (EFEO, 2026-10-22)", () => {
  const s = fs.sql('"efeo"', { n: 10, offset: 0, names: ["efeo"] });
  eq(/THEN 3\.0 WHEN .* THEN 2\.5 WHEN .* THEN 2\.0/.test(s.text), true, "exact piece 3, starts 2.5, carries 2");
  eq(s.binds.slice(0, 3).join("|"), " · efeo · | · efeo|efeo", "binds in tier order");
});
t("nearest orders the rows whose title or address answers first", () => {
  const s = fs.sql('"a"', { n: 10, offset: 0, sort: "near", pin: { lat: 18.79, lon: 98.98 } });
  eq(s.binds[0], '{title_s url_s} : ("a")');
  eq(/ORDER BY g DESC, \(s\.lat IS NULL\)/.test(s.text), true, "good matches first, then distance");
});
t("a shelf the query names is picked over a tag page, in the reader's city", () => {
  const rows = [
    { url: "https://motdang.net/cm/tag/multi-source--massage.html", title: "มีหลายแหล่งตรงกัน · นวด-สปา เชียงใหม่ · More than one source agrees · Massage & Spa, Chiang Mai · มดแดง Mot Dang" },
    { url: "https://motdang.net/cr/massage/index.html", title: "นวด-สปา เชียงราย · Massage & Spa, Chiang Rai · มดแดง Mot Dang" },
    { url: "https://motdang.net/cm/massage/index.html", title: "นวด-สปา เชียงใหม่ · Massage & Spa, Chiang Mai · มดแดง Mot Dang" },
    { url: "https://motdang.net/cm/food/cafe/index.html", title: "กาแฟ-คาเฟ่ ร้านอาหาร-ของกิน เชียงใหม่ · Coffee & Cafés, Chiang Mai · มดแดง Mot Dang" },
    { url: "https://motdang.net/map.html", title: "แผนที่เมือง · มดแดง Mot Dang" },
  ];
  const pick = (f, pin) => (fs.doorPick(rows, f, pin) || {}).url || "";
  eq(pick(["massage"]), "https://motdang.net/cm/massage/index.html");
  eq(pick(["นวด"]), "https://motdang.net/cm/massage/index.html");
  eq(pick(["massage"], { lat: 19.91, lon: 99.84 }), "https://motdang.net/cr/massage/index.html", "Chiang Rai");
  eq(pick(["coffee"]), "https://motdang.net/cm/food/cafe/index.html");
  eq(pick(["map"]), "https://motdang.net/map.html");
  eq(pick(["spa massage"]), "", "two words that name no one shelf");
  eq(fs.doorSql(["massage"]).length, 2, "an address ask and a title ask");
});

const W = await import(join(ROOT, "publish/worker.js"));
t("plain http answers 301 to https, path and query kept", () => {
  const r = W.toHttps(new Request("http://motdang.net/find?q=a%20b&p=2"));
  eq(r.status, 301);
  eq(r.headers.get("location"), "https://motdang.net/find?q=a%20b&p=2");
  eq(W.toHttps(new Request("https://motdang.net/")), null);
  eq(W.toHttps(new Request("http://localhost:8787/")), null, "wrangler dev is left alone");
});

const P = await import(join(ROOT, "publish/findpins.js"));
const BANSABAI = "https://motdang.net/cm/p/ban-sabai-village-senior-residence-and-care-home-860456741841507.html";
t("a pin answers its words as a phrase, in either script", () => {
  for (const q of ["ban sabai", "Ban Sabai Village", "BAN-SABAI!", "nursing homes chiang mai", "care home", "seniors", "senior care", "care for seniors chiang mai",
                   "บ้านสบาย", "บ้านสบาย ซีเนียร์", "บ้านพักคนชรา เชียงใหม่", "บ้านพัก คนชรา"]) {
    eq(P.pinsFor(q).get(BANSABAI), P.PIN_X, q);
  }
  for (const q of ["sabai", "home", "care", "khao soi", "sabai sabai massage", "home pro"]) {
    eq(P.pinsFor(q).size, 0, q);
  }
});
t("a pinned page outranks a title tier, and its bind sits where its ? sits", () => {
  const s = fs.sql('"ban" AND "sabai"', { names: ["ban sabai"], pins: P.pinsFor("ban sabai"), n: 10 });
  ok(s.text.includes("CASE lp.url WHEN ? THEN ?"), "pin CASE in the score");
  ok(s.text.indexOf("JOIN pages lp") === s.text.lastIndexOf("JOIN pages lp"), "one join for pins");
  const qs = (s.text.match(/\?/g) || []).length;
  eq(qs, s.binds.length, "every ? has its bind");
  const i = s.binds.indexOf(BANSABAI);
  ok(i > 0 && s.binds[i + 1] === P.PIN_X, "url then multiplier");
  ok(P.PIN_X > 3 * 1.6 * 1.25 * 10, "beats title × near × learned with room to spare");
  const both = fs.sql('"ban" AND "sabai"', { names: ["ban sabai"], learn: new Map([["https://x.test/a", 1.2]]),
                                             pins: P.pinsFor("ban sabai"), n: 10 });
  eq((both.text.match(/\?/g) || []).length, both.binds.length, "learned + pinned binds line up");
  ok(both.text.indexOf("JOIN pages lp") === both.text.lastIndexOf("JOIN pages lp"), "learned + pinned share one join");
  const plain = fs.sql('"ban" AND "sabai"', { n: 10, pins: new Map() });
  ok(!plain.text.includes("CASE lp.url"), "no pin, no CASE");
});

/* intents.js: what a reader asks for besides the thing (Nan, 2026-10-04). */
const IN = await import(join(ROOT, "publish/intents.js"));
t("intent words leave the match, or turn into the shelf word, or stay and add a line", () => {
  const l = (q) => { const x = fs.liftIntent(q); return `${x.q}|${x.heard.map((h) => h.id).join(",")}`; };
  eq(l("halal khao soi near me"), "khao soi|halal");
  eq(l("massage open late"), "massage|late");
  eq(l("ถนนคนเดินวันอาทิตย์"), "ถนนคนเดิน|sunday");
  eq(l("aircon broken"), "aircon repair|fix");
  eq(l("who buys gold"), "รับซื้อ gold|sell");
  eq(l("how to get to wat chedi luang"), "wat chedi luang|route");
  eq(l("ไปวัดเจดีย์หลวงยังไง"), "วัดเจดีย์หลวง|route");
  eq(l("วิธีทำข้าวซอย"), "ทำข้าวซอย|howto");
  eq(l("condo for rent"), "condo rent|rent");
  eq(l("emergency hospital"), "emergency hospital|urgent");
  eq(l("chiang rai weather"), "chiang rai weather|weather");
});
t("an intent word alone is still a search, and a compound keeps its word", () => {
  const l = (q) => { const x = fs.liftIntent(q); return `${x.q}|${x.heard.map((h) => h.id).join(",")}`; };
  eq(l("wifi"), "wifi|wifi");
  eq(l("gluten free bakery"), "gluten free bakery|");
  eq(l("contact lens"), "contact lens|");
  eq(l("รับซื้อทอง"), "รับซื้อทอง|");
  eq(fs.liftIntent("ทองรับซื้อ").q, "ทองรับซื้อ", "รับซื้อ is not buy");
});
t("prefer groups rank the rows that carry the thing first, binds in order", () => {
  const heard = fs.liftIntent("halal khao soi open late").heard;
  const scheds = new Map([[7, [[1350, 1440]]], [8, [[600, 900]]]]);
  const pr = IN.preferOf(heard, { phrase: fs.phrase, seg: null, scheds, openAt: fs.openAt });
  eq(pr.map((g) => g.id).join(","), "late,halal");
  eq(pr[0].sk.join(","), "7", "open at 22:30 any day");
  ok(pr[1].fac.includes("halal") && /"halal"/.test(pr[1].match), "halal by facet and by word");
  for (const sort of ["rank", "near"]) {
    const s = fs.sql('"khao soi"', { n: 10, sort, pin: { lat: 18.79, lon: 98.98 }, prefer: pr });
    eq((s.text.match(/\?/g) || []).length, s.binds.length, `${sort}: binds line up`);
    ok(s.text.includes("JOIN pages pf"), `${sort}: facets read from pages`);
  }
});
t("lead lines: emergency numbers, the route planner on the first place, listings only for a home", () => {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const h = (q, top) => { const x = fs.liftIntent(q); return IN.leadHtml(x.heard, { top, q: x.q, esc }); };
  ok(h("emergency").includes('href="tel:1669"'), "1669");
  ok(h("how to get to wat chedi luang", { url: "https://motdang.net/cm/p/wat-chedi-luang.html", title: "วัดเจดีย์หลวง · Wat Chedi Luang" })
    .includes("plan.html?stops=cm%3Awat-chedi-luang&amp;go=1"), "Guide me");
  ok(h("condo for rent").includes("/listings/"), "condo → listings");
  eq(h("scooter rental"), "", "scooter → no listings line");
  eq(h("car rental"), "", "car → no listings line");
  eq(h("เช่ารถ"), "", "car hire in Thai → no listings line");
  eq(h("ร้านขายยา"), "", "a pharmacy is not a sale");
  for (const q of ["rent", "house for sale", "buy a house", "บ้านให้เช่า", "คอนโดเชียงใหม่", "land for sale chiang mai",
                   "real estate agent", "monthly apartment"]) ok(h(q).includes("/listings/"), `${q} → listings`);
  for (const q of ["maid", "หาแม่บ้าน", "plumber", "laundry near me", "ซ่อมบ้าน", "gardener"]) {
    ok(h(q).includes("/home-help/?near=1"), `${q} → home help`);
  }
  eq(h("maid cafe"), "", "a maid café is a café");
  eq(h("dry cleaning"), "", "dry cleaning is a shop");
  ok(h("jobs").includes("/home-help/join"), "jobs → list yourself");
  eq(h("workout"), "", "a workout is not work");
});

t("MASSIVE false lifts stay fixed: vacuums, Uber, students, San Kamphaeng, CJ, orders", () => {
  const l = (q) => { const x = fs.liftIntent(q); return `${x.q}|${[x.price, x.buy && "buy", ...x.heard.map((h) => h.id)].filter(Boolean).join(",")}`; };
  eq(l("เครื่องดูดฝุ่น"), "เครื่องดูดฝุ่น|");
  eq(l("เรียกอูเบอร์ให้หน่อย"), "เรียกอูเบอร์ให้หน่อย|taxi");
  eq(l("นักเรียน"), "นักเรียน|");
  eq(l("ร้านอาหารสันกำแพง"), "ร้านอาหารสันกำแพง|");
  eq(l("ซีเจ"), "ซีเจ|");
  eq(l("คำสั่งซื้อ"), "คำสั่งซื้อ|");
  eq(l("good morning"), "good morning|");
  eq(l("are you free tonight"), "are you free tonight|");
  eq(l("ท่าอากาศยานเชียงใหม่"), "ท่าอากาศยานเชียงใหม่|transit", "the airport, not the weather");
});
t("MASSIVE gaps heard: Thai inside a run, near said first, takeaway, hours", () => {
  const l = (q) => { const x = fs.liftIntent(q); return `${x.q}|${[x.near && "near", ...x.heard.map((h) => h.id)].filter(Boolean).join(",")}`; };
  eq(l("สภาพอากาศวันนี้"), "สภาพอากาศวันนี้|weather");
  eq(l("แถวนี้มีร้านกาแฟไหม"), "มีร้านกาแฟไหม|near");
  eq(l("ร้านกาแฟใกล้ที่สุด"), "ร้านกาแฟ|near");
  eq(l("ซื้อกลับบ้าน ข้าวมันไก่"), "ข้าวมันไก่|delivery");
  eq(l("what time does maya open"), "maya open|hours");
  eq(l("แท็กซี่ไปสนามบิน"), "แท็กซี่ไปสนามบิน|transit,taxi");
});

/* findmeaning.js: the bge-m3 half (Nan, 2026-10-04: "both"). */
const FM = await import(join(ROOT, "publish/findmeaning.js"));
t("meaning boosts close pages by address, rescues only the close ones not shown", () => {
  const hits = [{ url: "https://motdang.net/a.html", score: 0.5 }, { url: "https://motdang.net/b.html", score: 0.42 },
                { url: "https://motdang.net/c.html", score: 0.33 }];
  const b = FM.semBoost(hits);
  eq(b.get("https://motdang.net/a.html"), 1.6, "whole boost at 0.47+");
  ok(b.get("https://motdang.net/b.html") > 1 && b.get("https://motdang.net/b.html") < 1.6, "part boost");
  ok(!b.has("https://motdang.net/c.html"), "noise not boosted");
  eq(FM.rescueRows(hits, [{ url: "https://motdang.net/a.html" }]).map((h) => h.url).join(","), "https://motdang.net/b.html");
  const s = fs.sql('"quiet"', { n: 10, sem: b, learn: new Map([["https://motdang.net/x.html", 1.2]]) });
  eq((s.text.match(/\?/g) || []).length, s.binds.length, "meaning binds line up");
  ok(s.text.indexOf("JOIN pages lp") === s.text.lastIndexOf("JOIN pages lp"), "one join for learned + meaning");
});

if (process.argv.includes("--dump")) {
  const out = {};
  for (const [q, adv] of CASES) out[(adv ? "adv:" : "") + q] = steps(q, adv);
  console.log("DUMP " + JSON.stringify(out));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
