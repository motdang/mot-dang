/* fleetsearch.js — the fleet's search, answered at the edge.
 *
 * One box over every page of every site on the roster (fleetsearch/crawl.py
 * reads the builds; fleetsearch/load.py puts them in D1). The Worker takes the
 * query, turns it into an FTS5 MATCH expression, asks D1, and returns a page of
 * plain HTML: title, abstract, address, date, size. No script, no stylesheet
 * fetch, nothing to download before the first answer.
 *
 * Two doors, one engine:
 *   simple   words · +must · -never · "a phrase" · word*     (/find?q=)
 *            the lucky button goes straight to the first page found
 *   boolean  AND OR NOT NEAR ( ) "phrase" title: url: site:  (/find?adv=1)
 *            upper-case AND/OR/NOT/NEAR in the simple box also switch it on
 *
 * Thai is written without spaces, so a Thai run in a query is split with the
 * same dictionary the indexer used and sent as a phrase — the tokens then sit
 * next to each other in the index exactly as they do in the query.
 *
 * Simple mode loosens by steps, never all at once: every word, then any word,
 * then any word or a synonym the fleet thesaurus knows — and the page says
 * which step answered. Exported pieces are pure so tests/test_fleetsearch.py
 * can run the translation without a Worker. */

import { eventData, calMatch, calHtml, CAL_CSS } from "./calfind.js";
import { quickMatch, quickData, quickHtml, quickJson, QA_CSS } from "./quickanswer.js";
import { cachedGet } from "./r2cache.js";
import { norm, loose, edits, slack, INTENT_RULES } from "./searchcore.js";
import { learnedFor } from "./findlearn.js";
import { trustedGuess } from "./where.js";
import { pinsFor } from "./findpins.js";
import { liftMore, preferOf, saidOf, leadHtml, leadJson } from "./intents.js";
import { meaningSoon, semBoost, rescueRows, rescueHtml } from "./findmeaning.js";
import { OWN_SITE, ownWanted, ownPagesSoon, mergeOwn } from "./ownfind.js";
import { readingHtml, sayLine, stripHtml, rowData, PEEK_BTN, PREVIEW_CSS } from "./findpreview.js";

const RE_THAI = /[฀-๿]+/g;
const RE_ZW = /[​-‏‪-‮﻿]/g;
const RE_TOKCHAR = /[\p{L}\p{N}\p{M}]/u;
const OPS = new Set(["AND", "OR", "NOT", "NEAR"]);
const SYMBOL_OPS = { "&": "AND", "|": "OR", "!": "NOT", "~": "NEAR" };
const FIELDS = { title: "title_s", intitle: "title_s", url: "url_s", inurl: "url_s",
                 site: "site", host: "site", domain: "site" };
const NEAR_WORDS = 10;

/* Sorts. `rank` is FTS5's bm25, already negative-best, so it needs no
 * direction; the others carry `p.id` as a tiebreak because a page of results
 * with no stable order shuffles under the reader between page 1 and page 2. */
const SORTS = {
  rank: { th: "ตรงที่สุด", en: "Best match", by: "f.rank" },
  new: { th: "ใหม่สุด", en: "Newest", by: "p.lastmod DESC, p.id" },
  old: { th: "เก่าสุด", en: "Oldest", by: "p.lastmod, p.id" },
  az: { th: "ก-ฮ · A–Z", en: "", by: "p.title COLLATE NOCASE, p.id" },
  /* Nearest needs a position, so it is offered only when one is known and the
   * ordering is written by nearSql() rather than by a column name. */
  near: { th: "ใกล้ที่สุด", en: "Nearest", by: "", needsPin: true },
  /* keys.score counts what a listing holds beyond its words: a picture, each
   * way to reach it, a toilet, events, hours, recorded facts, a pin. */
  rich: { th: "ข้อมูลมากสุด", en: "Most detail", by: "p.score DESC, p.id" },
  /* Offered only when something in the answer has an event still to come. */
  soon: { th: "งานใกล้สุด", en: "Soonest event", by: "", needsEvents: true },
};

/* What a row can be filtered on. The bits are keys.has, written by
 * fleetsearch/load.py (HAS there); `open` is worked out from keys.sk and the
 * week schedules at the moment of asking, so it has no bit of its own. */
const HAS = { photo: 1, contact: 2, toilet: 4, events: 8, hours: 16, map: 32 };
const HAS_KEYS = ["photo", "contact", "toilet", "events", "hours", "open"];
/* [0] is a sprite id in docs/icons.svg, not an emoji — no emoji in shipped UI
 * (ICON-POLICY.md); rendered through sicon(). open-now reuses the clock with a
 * green state, the one gap the policy names. */
const HAS_LABEL = {
  photo: ["i-camera", "มีรูป", "Photo"],
  contact: ["i-phone", "ติดต่อได้", "Contact"],
  toilet: ["i-loo", "ห้องน้ำ", "Toilet"],
  events: ["i-party", "มีงาน", "Events"],
  hours: ["i-clock", "เวลาเปิด", "Hours"],
  open: ["i-clock", "เปิดอยู่", "Open now"],
};
const KINDS = { place: ["สถานที่", "Places"], list: ["รายการ", "Lists"], page: ["หน้าอื่น", "Other pages"] };
const WAY_LABEL = {
  phone: ["☎️", "โทร", "phone"], line: ["💬", "LINE", "LINE"], whatsapp: ["✆", "WhatsApp", "WhatsApp"],
  facebook: ["ⓕ", "เฟซบุ๊ก", "Facebook"], instagram: ["◎", "IG", "Instagram"], email: ["✉️", "อีเมล", "email"],
  web: ["🌐", "เว็บ", "website"], x: ["𝕏", "X", "X"], tiktok: ["♪", "TikTok", "TikTok"],
  youtube: ["▶", "YouTube", "YouTube"],
};
const TOILET_FACETS = new Set(["toilet", "toilethere", "toiletfree", "toiletfee5", "toiletfee10", "toiletnone"]);
/* Where fleetsearch/thumbs.py puts the pictures and map cells in the bucket. */
const THUMBS = "/tiles/find/";
const CELL_Z = 16;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_MIN = 10080;
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/* Today and the minute of the week in Chiang Mai, which is where the hours
 * and the event dates were written. Monday 00:00 is minute 0, the shape
 * importers/build_open_lamps.py writes. */
export function bangkok(now) {
  const t = new Date((now || new Date()).getTime() + 7 * 3600000);
  const day = (t.getUTCDay() + 6) % 7;
  return { today: t.toISOString().slice(0, 10), minute: day * 1440 + t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export function openAt(iv, minute) {
  for (const [a, b] of iv || []) {
    if ((minute >= a && minute < b) || (minute + WEEK_MIN >= a && minute + WEEK_MIN < b)) return true;
  }
  return false;
}

/* The next day an event falls on, from what the loader kept: a date, and for
 * a weekly event its weekdays (Monday 0) and the day it stops. */
export function nextDate(ev, today) {
  if (!ev || !ev.d) return "";
  if (!ev.w || !ev.w.length) return ev.d >= today ? ev.d : "";
  const start = ev.d > today ? ev.d : today;
  const s = new Date(start + "T00:00:00Z");
  const wd = (s.getUTCDay() + 6) % 7;
  const ahead = Math.min(...ev.w.map((w) => (w - wd + 7) % 7));
  const nxt = new Date(s.getTime() + ahead * 86400000).toISOString().slice(0, 10);
  return ev.u && nxt > ev.u ? "" : nxt;
}

/* The pin's place inside its map cell, in per cent. The cell is a 2×2 block of
 * zoom-16 tiles whose top-left tile is (hx, hy); thumbs.py chose it. */
export function cellPos(lat, lon, hx, hy) {
  const n = 2 ** CELL_Z;
  const X = ((lon + 180) / 360) * n;
  const Y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return [((X - hx) / 2) * 100, ((Y - hy) / 2) * 100];
}

/* Degrees are not metres and a degree of longitude shrinks towards the poles,
 * so a comparison in degrees alone would rank a place due east nearer than one
 * the same distance north. Scaling longitude by cos(latitude) fixes that, and
 * over one province the flat approximation is worth a metre or two — the pins
 * themselves are rounded harder than that. Squared, because a sort does not
 * need the square root. */
const M_PER_DEG = 111_320;
function nearSql(pin, col) {
  const k = Math.cos((pin.lat * Math.PI) / 180) ** 2;
  return `((${col}.lat - ${pin.lat}) * (${col}.lat - ${pin.lat})` +
         ` + (${col}.lon - ${pin.lon}) * (${col}.lon - ${pin.lon}) * ${k.toFixed(8)})`;
}
export function metres(a, b) {
  const dLat = (a.lat - b.lat) * M_PER_DEG;
  const dLon = (a.lon - b.lon) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/* What a reader is told about a distance, and no more than that.
 * Cloudflare's guess at where a request comes from is a city, not a person —
 * measured 2026-09-21, it put a connection in Chiang Mai 6 km from the house
 * it was sent from — so a coarse position is rounded to the nearest kilometre
 * and never given a decimal it has not earned. An exact fix, which only the
 * reader's own device can give, is drawn as it is. */
export function farLabel(m, exact) {
  if (!Number.isFinite(m)) return "";
  if (!exact) {
    if (m < 1500) return ["ใกล้ๆ", "nearby"];
    return [`~${Math.round(m / 1000)} กม.`, `~${Math.round(m / 1000)} km`];
  }
  if (m < 950) return [`${Math.round(m / 10) * 10} ม.`, `${Math.round(m / 10) * 10} m`];
  if (m < 9500) return [`${(m / 1000).toFixed(1)} กม.`, `${(m / 1000).toFixed(1)} km`];
  return [`${Math.round(m / 1000)} กม.`, `${Math.round(m / 1000)} km`];
}

const COMPASS = [["เหนือ", "N"], ["ตะวันออกเฉียงเหนือ", "NE"], ["ตะวันออก", "E"],
                 ["ตะวันออกเฉียงใต้", "SE"], ["ใต้", "S"], ["ตะวันตกเฉียงใต้", "SW"],
                 ["ตะวันตก", "W"], ["ตะวันตกเฉียงเหนือ", "NW"]];
export function bearing(from, to) {
  const dLat = to.lat - from.lat;
  const dLon = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  if (!dLat && !dLon) return null;
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/* `near=lat,lng` from the reader's own device; otherwise Cloudflare's guess,
 * which is a city. Which one it is travels with it, because the page says so
 * and the rounding depends on it. */
export function readerPin(sp, request) {
  const raw = (sp.get("near") || "").split(",").map(Number);
  if (raw.length === 2 && raw.every(Number.isFinite) &&
      Math.abs(raw[0]) <= 90 && Math.abs(raw[1]) <= 180 && (raw[0] || raw[1])) {
    return { lat: raw[0], lon: raw[1], exact: true };
  }
  /* Cloudflare's guess, only inside a covered city (where.js). */
  const g = trustedGuess((request && request.cf) || {});
  return g ? { lat: g.lat, lon: g.lon, exact: false, city: g.city } : null;
}
/* Where the words have to match. The index holds three columns and the page
 * draws only the title, so a reader who knows a page's name can say so and
 * stop matching the words nobody sees. */
const IN_COLS = { all: "", title: "title_s", url: "url_s" };
const IN_LABEL = { all: ["ทั้งหน้า", "Anywhere"], title: ["ชื่อหน้า", "Title"], url: ["ที่อยู่", "Address"] };
const SINCE = { "7d": ["7 วัน", "7 days", 7], "30d": ["30 วัน", "30 days", 30], "1y": ["ปีนี้", "A year", 365] };
const PER_PAGE = [10, 20, 50];
const MAX_PAGE = 100;
/* How deep a reader can go, and therefore how much a sort other than
 * relevance has to order: the same window either way. */
const WINDOW = 1000;
const MAX_Q = 300;
const CACHE_S = 600;
/* Below this many results, a page the reader has narrowed offers the way back
 * out: her ask was "uncheck them if the number of results you get is too
 * small" (WO-95). A filter that emptied the page is caught at zero already;
 * this catches the page that is nearly empty. */
const FEW = 20;

/* ------------------------------------------------------------ tokenising */

function clean(s) {
  return (s || "").normalize("NFC").replace(RE_ZW, "").replace(/\s+/g, " ").trim();
}

/* A Thai run → its dictionary words, spaced. `seg` is the fleet Segmenter
 * (SEARCHCORE.Segmenter, loaded by the Worker from the same file the indexer
 * read); without one the run is left whole, which still matches a page whose
 * text the dictionary could not split either. */
export function spaceThai(s, seg) {
  return clean(s).replace(RE_THAI, (run) => (seg ? seg.split(run) : [run]).join(" "));
}

/* One FTS5 phrase from a term's text: quoted, inner quotes doubled, a trailing
 * `*` kept as a prefix marker. Empty once nothing tokenisable is left. */
export function phrase(text, seg, prefix) {
  const t = spaceThai(text, seg).replace(/"/g, '""');
  if (!RE_TOKCHAR.test(t)) return "";
  return `"${t}"` + (prefix ? " *" : "");
}

/* The query string → tokens. Quotes group; parentheses stand alone; a sign,
 * a field and a trailing star ride on the term they touch. Boolean words
 * become operators only when `bool` is on (or when they are upper case,
 * which is how the simple box notices a boolean reader). */
export function tokenise(q, bool) {
  const s = clean(q).slice(0, MAX_Q);
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (c === "(" || c === ")") { out.push({ kind: c === "(" ? "lp" : "rp" }); i++; continue; }
    let j = i;
    let sign = "";
    if (c === "+" || c === "-" || c === "−") { sign = c === "+" ? "+" : "-"; j++; }
    let field = "";
    const fm = s.slice(j).match(/^([a-z]+):/i);
    if (fm && FIELDS[fm[1].toLowerCase()]) { field = FIELDS[fm[1].toLowerCase()]; j += fm[0].length; }
    let text = "";
    let quoted = false;
    if (s[j] === '"') {
      quoted = true;
      const k = s.indexOf('"', j + 1);
      text = k < 0 ? s.slice(j + 1) : s.slice(j + 1, k);
      j = k < 0 ? n : k + 1;
    } else {
      while (j < n && s[j] !== " " && s[j] !== "(" && s[j] !== ")") j++;
      text = s.slice(i + (sign ? 1 : 0) + (fm && field ? fm[0].length : 0), j);
    }
    let prefix = false;
    if (!quoted && text.endsWith("*")) { prefix = true; text = text.replace(/\*+$/, ""); }
    if (!quoted && !field && !sign) {
      const up = text.toUpperCase();
      if (SYMBOL_OPS[text]) { out.push({ kind: "op", op: SYMBOL_OPS[text] }); i = j; continue; }
      if (OPS.has(up) && (bool || text === up)) { out.push({ kind: "op", op: up }); i = j; continue; }
    }
    if (text) out.push({ kind: "term", text, sign, field, prefix, quoted });
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------ translation */

/* The plan for one query: the MATCH strings to try in order, the site filters,
 * and a note per step for the page to show when that step answered. */
export function plan(q, seg, thes) {
  const forced = /(^|\s)(AND|OR|NOT|NEAR)(\s|$)/.test(clean(q)) || /[()]/.test(q) && /\b(AND|OR|NOT|NEAR)\b/i.test(q);
  return forced ? planBoolean(q, seg) : planSimple(q, seg, thes);
}

/* ------------------------------------------------------------ variants
 * Other spellings of one thing — ข้าวซอย, khao soi, kao soi, khaosoi, khao soy
 * — come from the fleet thesaurus and join the FIRST step, so each of them
 * answers with the same set rather than only the spelling typed. A group
 * larger than GROUP_MAX is a mined blob (soi = road = street = ถนน) and is
 * left out of the first step. The joined key (khao soy → kosoi) is the
 * phonetic key of the letters with the spaces taken out, so a word written
 * split or joined reaches the same group. */
const GROUP_MAX = 8;
const VAR_MAX = 10;
const JOINED = new WeakMap();
function joinedIndex(thes) {
  let ix = JOINED.get(thes);
  if (ix) return ix;
  ix = new Map();
  thes.groups.forEach((mem, gid) => {
    if (mem.length > GROUP_MAX) return;
    for (const m of mem) {
      if (!/^[a-z][a-z ]*$/.test(m)) continue;
      const k = loose(m.replace(/ /g, ""));
      if (k.length < 5) continue;
      if (!ix.has(k)) ix.set(k, new Set());
      ix.get(k).add(gid);
    }
  });
  JOINED.set(thes, ix);
  return ix;
}

/* Other forms of one English word: singular and plural, British and American
 * spelling, -ural/-ure. "Arts and Cultural Centre" has to find "Art & Cultural
 * Center" (2026-10-22); FTS5 here has no stemmer. */
const SPELL_PAIRS = [["centre", "center"], ["theatre", "theater"], ["metre", "meter"], ["litre", "liter"],
                     ["colour", "color"], ["jewellery", "jewelry"], ["grey", "gray"], ["programme", "program"],
                     ["travelling", "traveling"], ["organisation", "organization"]];
export function englishForms(w) {
  const n = String(w || "").toLowerCase();
  if (!/^[a-z]{3,}$/.test(n)) return [];
  const out = new Set();
  for (const [a, b] of SPELL_PAIRS) {
    if (n.startsWith(a)) out.add(b + n.slice(a.length));
    if (n.startsWith(b)) out.add(a + n.slice(b.length));
  }
  if (/ise[sd]?$/.test(n)) out.add(n.replace(/ise([sd]?)$/, "ize$1"));
  if (/ize[sd]?$/.test(n)) out.add(n.replace(/ize([sd]?)$/, "ise$1"));
  /* plural to singular only: "museums" wants the places titled Museum, while
   * "temple" widened to "temples" pulled in every page that mentions temples */
  if (n.length > 4 && n.endsWith("ies")) out.add(n.slice(0, -3) + "y");
  else if (n.length > 4 && /(ch|sh|x|ss)es$/.test(n)) out.add(n.slice(0, -2));
  else if (n.length > 3 && n.endsWith("s") && !/(ss|us|is)$/.test(n)) out.add(n.slice(0, -1));
  if (n.endsWith("ural")) out.add(n.slice(0, -2) + "e");
  if (n.endsWith("ture")) out.add(n.slice(0, -1) + "al");
  /* "centres" → centre and centers, and so center */
  for (const v of Array.from(out)) {
    if (v.length > 3 && v.endsWith("s") && !/(ss|us|is)$/.test(v) && !n.endsWith("ies")) out.add(v.slice(0, -1));
  }
  out.delete(n);
  return Array.from(out).slice(0, 6);
}
/* A small group from the mined dictionary (dam, dike, เขื่อน) is a gloss: its
 * other-language word is a translation, its same-language words are other
 * senses ("Baan Dam" → dike; "Black House" → domestic; วัด → abbey). A group
 * that names a shelf ("coffee & cafés", วัด-สิ่งศักดิ์สิทธิ์) or holds five or
 * more was put together on purpose and keeps every member. */
const isThai = (x) => /[฀-๿]/.test(x);
function glossOnly(mem) {
  return mem.length <= 4 && !mem.some((m) => /&| - |^[฀-๿]+-[฀-๿]/.test(m));
}

export function variantsOf(text, thes) {
  if (!thes) return [];
  const n = norm(text);
  if (!n) return [];
  const forms = englishForms(n);
  let out = forms.slice();
  if (thes.groups && thes.index) {
    let gids = thes.index.get(n);
    /* "museums" sits only in a mined blob too big to use; "museum" has a group */
    const usable = (gs) => gs && Array.from(gs).some((g) => thes.groups[g].length <= GROUP_MAX);
    if (!usable(gids)) {
      for (const f of forms) { const fg = thes.index.get(f); if (usable(fg)) { gids = fg; break; } }
    }
    /* A word whose groups share nothing but the word itself has more than one
     * sense (grab: to arrest, to catch), and widening with every sense floods
     * the answer with the wrong ones; it is searched as typed. Groups that
     * overlap (hospital: โรงพยาบาล in both) are one sense and widen. */
    if (gids && gids.size > 1) {
      const same = new Set([n].concat(forms));
      const sets = Array.from(gids).filter((g) => thes.groups[g].length <= GROUP_MAX)
                        .map((g) => new Set(thes.groups[g].filter((m) => !same.has(m))));
      /* a group of one or two (coffee, เมล็ดกาแฟ; นวด: knead, rub) is a gloss,
       * not a second sense: it takes two groups of three or more that share
       * nothing to make a word ambiguous */
      const big = sets.filter((s) => s.size >= 3);
      const apart = big.some((s, i) => big.some((o, j) => j !== i && !Array.from(s).some((m) => o.has(m))));
      if (apart) return [];
    }
    if (!gids || !gids.size) {
      const lk = loose(n);
      const li = thes._looseIdx ? thes._looseIdx() : thes.looseIndex;
      if (lk.length >= 4 && li) gids = li.get(lk);
    }
    if ((!gids || !gids.size) && /^[a-z][a-z ]*$/.test(n)) gids = joinedIndex(thes).get(loose(n.replace(/ /g, "")));
    for (const g of gids || []) {
      const mem = thes.groups[g];
      if (mem.length > GROUP_MAX) continue;
      if (!glossOnly(mem)) { out.push(...mem); continue; }
      /* a gloss: its one word in the other language, a translation (dam →
       * เขื่อน, ร้านหนังสือ → bookstore); two or more there are other senses
       * (วัด → abbey, wat; นวด → knead, rub) and add nothing */
      const other = mem.filter((m) => isThai(m) !== isThai(n));
      if (other.length === 1) out.push(other[0]);
      /* and every member that sounds like the word: a group of spellings of
       * one name (nakorn, nakhon, นคร; payap, พายัพ) is not a gloss */
      const key = loose(n.replace(/ /g, ""));
      for (const m of mem) {
        const mk = loose(m.replace(/ /g, ""));
        if (key && mk && (mk === key || (key.length >= 4 && edits(mk, key, 1) <= 1))) out.push(m);
      }
    }
  } else {
    out = thes.expand(text) || [];
  }
  const seen = new Set([n]);
  const res = [];
  for (const v of out) {
    const vn = norm(v);
    if (!vn || seen.has(vn) || /[&,_]/.test(v)) continue;
    seen.add(vn);
    res.push(v);
    if (res.length >= VAR_MAX) break;
  }
  return res;
}

/* A known name the dictionary would take apart — รังมด is the Anthill, and
 * รัง + มด matched every page that says มด. `keep` holds such names (the site
 * register's Thai names); one typed whole is asked for whole, or as its pieces
 * side by side in a title. */
function keepWhole(text, seg, keep) {
  if (!keep || !seg || !/^[฀-๿]+$/.test(text)) return "";
  const n = norm(text);
  if (!keep.has(n)) return "";
  const parts = seg.split(n);
  return parts.length > 1 ? `("${n}" OR title_s : "${parts.join(" ")}")` : "";
}

const STOP_EN = new Set(["and", "&", "of", "the"]);
export function planSimple(q, seg, thes, extra) {
  const ex = extra || {};
  const toks = tokenise(q, false);
  const order = [], never = [], sites = [];
  /* Whether the reader named a column themselves — `title:` or `url:`. The
   * page's own "words in" filter stands down when they did. */
  let fields = false;
  for (const t of toks) {
    if (t.kind !== "term") continue;     // a stray operator word or paren is skipped
    if (t.field === "site") { sites.push(t.text.toLowerCase()); continue; }
    const kept = !t.field && !t.quoted && !t.prefix ? keepWhole(t.text, seg, ex.keep) : "";
    const p = kept || phrase(t.text, seg, t.prefix);
    if (!p) continue;
    if (t.field) fields = true;
    const words = t.quoted || t.prefix || kept ? [] : spaceThai(t.text, seg).split(" ").filter((w) => RE_TOKCHAR.test(w));
    const item = { p, col: t.field, text: t.text, prefix: t.prefix, quoted: t.quoted, words, sign: t.sign, kept: !!kept };
    (t.sign === "-" ? never : order).push(item);
  }
  /* "and", "of", "the" in a name of three words or more are not asked for:
   * "City Art and Culture Center" is titled "City Art & Cultural Center". */
  const said = order.slice();
  if (order.length >= 3) {
    const kept = order.filter((it) => !(STOP_EN.has(String(it.text).toLowerCase()) && !it.col && !it.quoted && it.sign !== "+"));
    if (kept.length >= 2) order.splice(0, order.length, ...kept);
  }
  const col = (it) => (it.col ? `${it.col} : ${it.p}` : it.p);
  const not = (expr) => never.length ? `(${expr})` + never.map((it) => ` NOT ${col(it)}`).join("") : expr;
  const steps = [];
  if (!order.length) {
    return { steps, sites, fields, mode: "simple", empty: true,
             negOnly: never.map((it) => it.text) };
  }

  /* Units: a run of two or three plain words that the thesaurus knows as one
   * thing (khao soi) is one unit; every other word is its own. */
  const plain = (it) => !it.col && !it.prefix && !it.quoted && !it.kept;
  const units = [];
  const fixes = ex.fix || {};
  for (let i = 0; i < order.length;) {
    let took = 0;
    for (let len = Math.min(3, order.length - i); len >= 2 && thes; len--) {
      const run = order.slice(i, i + len);
      if (!run.every(plain) || run.some((it) => it.sign !== run[0].sign)) continue;
      const vs = variantsOf(run.map((it) => it.text).join(" "), thes);
      if (vs.length) { units.push({ items: run, vars: vs, sign: run[0].sign }); took = len; break; }
    }
    if (took) { i += took; continue; }
    const it = order[i];
    /* A word already on tens of thousands of pages (ร้าน, เชียงใหม่) is not
     * widened: its synonyms add nothing a reader can page to, and an OR over
     * two huge posting lists is the slowest thing the index can be asked. */
    const vs = plain(it) && !(ex.common && ex.common.has(it.text)) ? variantsOf(it.text, thes) : [];
    units.push({ items: [it], vars: vs.concat(fixes[it.text] || []), sign: it.sign, fixed: !!fixes[it.text] });
    i++;
  }
  const base = (u) => (u.items.length > 1 ? "(" + u.items.map(col).join(" AND ") + ")" : col(u.items[0]));
  const wide = (u, b) => {
    const alts = Array.from(new Set(u.vars.map((v) => phrase(v, seg, false)).filter((p) => p && p !== b)));
    return alts.length ? "(" + [b].concat(alts).join(" OR ") + ")" : b;
  };
  const must = units.filter((u) => u.sign === "+"), may = units.filter((u) => u.sign !== "+");
  const pos = must.concat(may);
  const shown = Array.from(new Set(units.flatMap((u) => u.vars))).slice(0, 4);
  const fixed = units.filter((u) => u.fixed);
  steps.push({ match: not(pos.map((u) => wide(u, base(u))).join(" AND ")),
               note: fixed.length ? "" : shown.length ? `รวมคำพ้อง · with synonyms: ${shown.join(", ")}` : "" });
  /* A compound the dictionary split (ร้านกาแฟนิมมาน → ร้านกาแฟ นิมมาน) is asked
   * for as a phrase first, then as its words anywhere on the page. */
  const split = (u) => {
    if (u.items.length > 1 || u.items[0].words.length < 2) return wide(u, base(u));
    const it = u.items[0];
    return wide(u, "(" + it.words.map((w) => (it.col ? `${it.col} : "${w}"` : `"${w}"`)).join(" AND ") + ")");
  };
  if (pos.some((u) => u.items.length === 1 && u.items[0].words.length > 1)) {
    steps.push({ match: not(pos.map(split).join(" AND ")),
                 note: "แยกคำ — ใกล้เคียงที่สุดก่อน · words split — closest first" });
  }
  if (may.length > 1) {
    const any = "(" + may.map((u) => wide(u, base(u))).join(" OR ") + ")";
    steps.push({ match: not(must.map((u) => wide(u, base(u))).concat([any]).join(" AND ")), partial: true,
                 note: "ไม่ครบทุกคำ — ใกล้เคียงที่สุดก่อน · not every word — closest first" });
  }
  if (fixed.length) {
    const said = fixed.map((u) => `${u.items[0].text} → ${(fixes[u.items[0].text] || []).join(", ")}`).join(" · ");
    for (const s of steps) {
      s.note = `ใกล้เคียงการสะกด — ใกล้ที่สุดก่อน · near spellings — closest first: ${said}`;
    }
  }
  /* The words as one name, for the name tier in sql(): only a plain query —
   * no −never, no column, no prefix — reads as the name of something. Matched
   * against the title as written (keys.title), so a Thai name stays unspaced. */
  const nameOk = !never.length && !fields && !order.some((it) => it.prefix);
  const name = nameOk ? clean(said.map((it) => it.text).join(" ")).toLowerCase() : "";
  const names = name ? [name].concat(units.length === 1 ? units[0].vars.map((v) => v.toLowerCase()) : [])
    .filter((v, k, a) => v && a.indexOf(v) === k).slice(0, 5) : [];
  const items = order.map((it) => ({ text: it.text, plain: plain(it) }));
  return { steps, sites, fields, mode: "simple", name, names, items };
}

export function planBoolean(q, seg) {
  const toks = tokenise(q, true);
  const sites = [];
  const terms = [];
  let fields = false;
  for (const t of toks) {
    if (t.kind === "term" && t.field === "site") { sites.push(t.text.toLowerCase()); continue; }
    if (t.kind === "term" && t.field) fields = true;
    terms.push(t);
  }
  let i = 0;
  const peek = () => terms[i];
  const take = () => terms[i++];
  const isOp = (op) => peek() && peek().kind === "op" && peek().op === op;
  const startsFactor = () => peek() && (peek().kind === "term" || peek().kind === "lp");
  let error = "";
  const negOnly = [];

  function factor() {
    const t = peek();
    if (!t) return null;
    if (t.kind === "lp") {
      take();
      const inner = orExpr();
      if (peek() && peek().kind === "rp") take();
      return inner ? { s: `(${inner.s})`, group: true } : null;
    }
    if (t.kind === "rp") { take(); return factor(); }
    if (t.kind === "op") {
      if (t.op === "NOT") {
        take();
        const f = factor();
        if (!f) return null;
        return { s: f.s, neg: true, group: f.group };
      }
      take();                     // a dangling AND/OR/NEAR: skipped
      return factor();
    }
    take();
    const p = phrase(t.text, seg, t.prefix);
    if (!p) return factor();
    const s = t.field ? `${t.field} : ${p}` : p;
    return { s, neg: t.sign === "-", plain: !t.field && !t.prefix };
  }

  function nearExpr() {
    let left = factor();
    if (!left) return null;
    const parts = [left];
    while (isOp("NEAR")) {
      take();
      const right = factor();
      if (!right) break;
      parts.push(right);
    }
    if (parts.length === 1) return left;
    if (parts.some((p) => !p.plain)) { error = "NEAR joins words, not groups or fields"; return left; }
    return { s: `NEAR(${parts.map((p) => p.s).join(" ")}, ${NEAR_WORDS})`, neg: parts[0].neg };
  }

  /* A NOT with nothing before it is held until a word to keep turns up
   * ("NOT khao soi" is soi without khao). With none at all there is nothing
   * to subtract from, and nothing is searched: asking for the subtracted word
   * instead returned every page that has it. */
  function andExpr() {
    let left = null;
    const pend = [];
    for (let first = true; ; first = false) {
      let op = "AND";
      if (!first) {
        if (isOp("AND")) { take(); if (isOp("NOT")) { take(); op = "NOT"; } }
        else if (isOp("NOT")) { take(); op = "NOT"; }
        else if (!startsFactor()) break;
      }
      const right = nearExpr();
      if (!right) break;
      if (op === "NOT" || right.neg) {
        if (left) left = { s: `(${left.s} NOT ${right.s})` };
        else pend.push(right.s);
        continue;
      }
      left = left ? { s: `(${left.s} AND ${right.s})` } : { s: right.s, group: right.group, plain: right.plain };
      while (left && pend.length) left = { s: `(${left.s} NOT ${pend.shift()})` };
    }
    if (!left && pend.length) { error = "NOT needs a word before it"; negOnly.push(...pend); }
    return left;
  }

  function orExpr() {
    let left = andExpr();
    if (!left) return null;
    while (isOp("OR")) {
      take();
      const right = andExpr();
      if (!right) break;
      left = { s: `(${left.s} OR ${right.s})` };
    }
    return left;
  }

  let root = orExpr();
  while (i < terms.length) {         // anything after a stray ")" is ANDed on
    const before = i;
    const more = orExpr();
    if (more && root) root = { s: `(${root.s} AND ${more.s})` };
    else if (more) root = more;
    if (i === before) i++;
  }
  if (!root) return { steps: [], sites, fields, mode: "boolean", empty: true, error, negOnly };
  return { steps: [{ match: root.s, note: "" }], sites, fields, mode: "boolean", error };
}

/* ------------------------------------------------------------ intent
 * A reader types requests, not keywords: "khao soi near me" is one noun and a
 * sort; "cheap massage" is one noun and a price. The constraint words come
 * out of the match first (searchcore's INTENT_RULES, the same lists the place
 * search reads) and are answered here: near → nearest first, open now → the
 * open-now filter, a price → said out loud, since no page carries one. */
const LIFT = { near: [], open: [], price: [] };
/* A purchase word says what the reader wants to do, not which place it is
 * (Nan, 2026-10-04: "retatrutide buy" matched Power Buy). It leaves the match
 * when other words stay, and the answer box reads it as "where to get it". */
LIFT.buy = ["where can i buy", "where can i get", "where to buy", "where to get", "where do i buy",
  "where do i get", "buy", "buying", "purchase", "to buy",
  "ซื้อที่ไหน", "หาซื้อที่ไหน", "มีขายที่ไหน", "ขายที่ไหน", "หาซื้อ", "ซื้อ"];
for (const [name, value, pats] of INTENT_RULES) {
  if (name === "near") LIFT.near.push(...pats);
  else if (name === "open" && value === "now") LIFT.open.push(...pats);
  else if (name === "price") LIFT.price.push(...pats.map((p) => [p, value]));
}
/* More ways to say near me, from Amazon's MASSIVE requests (2026-10-04).
 * Not a bare "near": "near X" names a place to be near, not the reader. */
LIFT.near.push("nearest", "closest", "in my area", "in this area", "around me", "close by",
  "ใกล้ที่สุด", "ย่านนี้", "บริเวณนี้", "ละแวกนี้", "ใกล้บ้าน");
/* Thai words that end in a constraint without being one: สันกำแพง is a
 * district, not "expensive"; รับซื้อ and คำสั่งซื้อ are not "buy". */
const NOT_AFTER = { "แพง": "กำ", "ซื้อ": "รับ|สั่ง" };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function liftIntent(q) {
  const out = { q, near: false, open: false, price: "", buy: false, heard: [], said: [] };
  if (!q || /["()]/.test(q) || isBoolean(q)) return out;
  let s = " " + clean(q) + " ";
  const take = (p) => {
    if (/[฀-๿]/.test(p)) {
      /* Thai has no spaces: a constraint counts standing alone or at the end
       * of a run (ข้าวซอยใกล้ฉัน), never at its start or inside it — ถูกต้อง
       * is "correct", not "cheap". */
      /* รับซื้อ is "we buy", the shop that buys from you — not ซื้อ. */
      const na = NOT_AFTER[p] ? `(?<!${NOT_AFTER[p]})` : "";
      const re = new RegExp(`${na}${reEsc(p)}(?=[^\\u0e00-\\u0e7f]|$)`);
      if (!re.test(s)) return false;
      s = s.replace(re, (m) => m.replace(p, " "));
      return true;
    }
    const re = new RegExp(`(\\s)${reEsc(p)}(?=\\s)`, "i");
    if (!re.test(s)) return false;
    s = s.replace(re, "$1 ");
    return true;
  };
  const longest = (a) => a.slice().sort((x, y) => (y[0] || y).length - (x[0] || x).length);
  for (const p of longest(LIFT.near)) if (take(p)) { out.near = true; out.said.push(p); }
  /* แถวนี้มีร้านกาแฟไหม: near me said first. */
  const nearFront = /(^|\s)(แถวนี้|ใกล้ฉัน|ใกล้ๆ)(?=[\u0e00-\u0e7f])/;
  if (nearFront.test(s)) { out.said.push(s.match(nearFront)[2]); s = s.replace(nearFront, "$1"); out.near = true; }
  for (const p of longest(LIFT.open)) if (take(p)) { out.open = true; out.said.push(p); }
  for (const [p, v] of longest(LIFT.price)) if (take(p)) { out.price = out.price || v; out.said.push(p); }
  /* The rest of what a reader asks for (intents.js): rank-first constraints,
   * shelf words, lead lines. Words taken out come back when nothing else is
   * left, so "wifi" alone still searches for wifi. */
  const more = liftMore(s);
  s = more.s;
  out.heard = more.heard;
  for (const h of more.heard) out.said.push(h.said);
  if (!clean(s) && more.removed.length) s = " " + more.removed.join(" ") + " ";
  const before = s;
  for (const p of longest(LIFT.buy)) if (take(p)) { out.buy = true; out.said.push(p); }
  /* Thai says it up front too: หาซื้อยาลดน้ำหนัก is "looking to buy" + the thing. */
  if (/(^|\s)หาซื้อ(?=[\u0e00-\u0e7f])/.test(s)) { s = s.replace(/(^|\s)หาซื้อ(?=[\u0e00-\u0e7f])/, "$1"); out.buy = true; out.said.push("หาซื้อ"); }
  if (out.buy && !clean(s)) { s = before; out.buy = false; out.said = out.said.filter((p) => !LIFT.buy.includes(p)); }
  out.q = clean(s);
  return out;
}

export function isBoolean(q) {
  return /(^|\s)(AND|OR|NOT|NEAR)(\s|$)/.test(clean(q)) || (/[()]/.test(q) && /\b(AND|OR|NOT|NEAR)\b/i.test(q));
}

/* ------------------------------------------------------------ the query */

/* A site is a column of the FTS row (host, id, host/id), so `site:` narrows
 * inside the match and no join is needed. A date range, a sort by anything but
 * rank, and every facet join `pages`.
 *
 * `in` wraps the whole expression in one column — `title_s : (…)` — and is
 * dropped when the reader's own query already names columns, because FTS5
 * lets the outer filter win and a `url:` term inside a title-only search
 * would quietly match nothing. */
export function narrow(match, opts) {
  const o = opts || {};
  let m = match;
  const col = IN_COLS[o.in] || "";
  if (col && !o.fields) m = `${col} : (${m})`;
  if (o.sites && o.sites.length) {
    const alt = o.sites.map((x) => phrase(x, null, false)).filter(Boolean)
                       .map((p) => `site_s : ${p}`);
    if (alt.length) m = `(${m}) AND (${alt.join(" OR ")})`;
  }
  return m;
}

/* The ORDER BY for one sort, written against `s` inside the window and against
 * `k` and `p` on the ten rows that come back. A row with no pin is UNMEASURED,
 * not far: it sorts last and is never dropped. A row with no event to come
 * sorts after every row that has one, the same way. */
function orderBy(sort, o, keys, rows) {
  if (sort === "near") {
    return `(${keys}.lat IS NULL), ${nearSql(o.pin, keys)}, ${rows}.id`;
  }
  if (sort === "soon") {
    return `(${keys}.evn IS NULL OR ${keys}.evu < '${o.today}'), ${keys}.evn, ${rows}.id`;
  }
  return SORTS[sort].by.replace(/\bp\.(lastmod|title|score)\b/g, `${keys}.$1`)
                       .replace(/\bp\.id\b/g, `${rows}.id`);
}

/* The conditions on `keys q` for the filters in force, leaving out the ones
 * named in `except` — a facet counts its own options with every OTHER filter
 * applied. `today` and `open` (the schedule ids open this minute) come from
 * the handler; every value that is not a number travels as a bind. */
/* bbox=west,south,east,north → [w, s, e, n], or null. The city map asks for
 * the places in view (Nan, 2026-10-20, gemba 2: its old engine took 5–17 s). */
export function bboxOf(v) {
  const b = String(v || "").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return null;
  const [w, s, e, n] = b;
  if (s < -90 || n > 90 || w < -180 || e > 180 || s >= n || w >= e) return null;
  return b;
}

export function keyFilters(o, except) {
  const x = except || {};
  const where = [], binds = [];
  if (!x.date) {
    if (o.from) { where.push("q.lastmod >= ?"); binds.push(o.from); }
    if (o.to) { where.push("q.lastmod <= ?"); binds.push(o.to); }
  }
  if (!x.kind && o.kind) { where.push("q.kind = ?"); binds.push(o.kind); }
  if (!x.bbox && o.bbox) {
    where.push("q.lat BETWEEN ? AND ? AND q.lon BETWEEN ? AND ?");
    binds.push(o.bbox[1], o.bbox[3], o.bbox[0], o.bbox[2]);
  }
  if (!x.sec && o.sec) { where.push("q.sec = ?"); binds.push(o.sec); }
  if (!x.has) {
    let mask = 0;
    for (const h of o.has || []) if (HAS[h] && h !== "events") mask |= HAS[h];
    if (mask) where.push(`(q.has & ${mask}) = ${mask}`);
    if ((o.has || []).includes("events")) { where.push(`(q.has & ${HAS.events}) > 0 AND q.evu >= ?`); binds.push(o.today); }
    if ((o.has || []).includes("open")) where.push(openSql(o.open));
  }
  return { where, binds };
}

function openSql(open) {
  const ids = (open || []).filter(Number.isInteger);
  return ids.length ? `q.sk IN (${ids.join(",")})` : "0";
}

/* Record-quality tag pages — "Website held", "More than one source agrees",
 * "A thin entry" — describe the entry, not the place (data/tags.json, the
 * `state` family, rails:false). They match every shelf word and are no
 * answer to anyone, so the handler's match leaves them out (`drop`). */
const STATE_TAGS = ["tag has", "tag multi source", "tag stub", "tag name only", "tag no pin", "tag no contact"];
export const DROP = ` NOT url_s : (${STATE_TAGS.map((t) => `"${t}"`).join(" OR ")})`;
export function matchFor(match, o) {
  const m = narrow(match, o);
  return o && o.drop ? `(${m})${DROP}` : m;
}

/* Relevance, inside the best RANK_WIN matches, reads three more things than
 * bm25 does:
 *   the name — FTS5's bm25 divides by the length of the WHOLE row, so a page
 *     with a long body loses on its title however heavy the title weight ("tha
 *     phae gate" put the Roads page titled "Tha Phae Gate" sixth). A title with
 *     a piece that IS the query counts three times, one that contains it twice;
 *   the distance — a pinned row within ~5 km of the reader counts 1.6 times,
 *     and further out loses weight with the square of the distance (equal to
 *     an unpinned row at ~20 km, a twelfth at ~125 km), so "khao soi" from
 *     Chiang Mai starts in Chiang Mai, not Fang. A row with no pin is
 *     unmeasured, not far, and keeps its weight.
 *   the events — keys.evc counts the events and weekly series listed at a
 *     place, coming and gone (the event ledger, Nan 2026-10-04): 1.05 for one,
 *     up to 1.5 from ten, so a venue's run of evenings orders rows that
 *     matched about as well and stays below a title tier.
 * The set is the same RANK_WIN rows as plain rank, and RANK_WIN is a multiple
 * of every page size, so paging past it neither repeats nor skips a row. */
const RANK_WIN = 200;
const NEAR_FREE = 0.002;      // degrees², ~5 km
const NEAR_HALF = 0.07;       // degrees², the weight halves ~30 km out
const NEAR_BONUS = 1.6;       // a pinned row within ~5 km, against an unpinned one
const GUESS_FLOOR = 0.5;      // under a network guess, the least a pinned row keeps

const COLS = "p.id, k.site, k.host, p.url, p.title, p.abstract, k.lastmod, p.kb, k.lat, k.lon," +
             " k.kind, k.has, k.sk, k.evn, k.evu, p.crumbs, p.thumb, p.rich";

/* A Mot Dang list page by its address: a shelf, a tag page, a district page —
 * anything under /cm/ or /cr/ that is not a place (/p/). keys.kind cannot say:
 * crawl.py reads it from an ItemList the paged and district lists lack (8,002
 * of 8,877 paged lists were "page" in the 2026-10-07 index). lp is pages. */
const DIR_SQL = "((lp.url GLOB 'https://motdang.net/c[mr]/*' AND lp.url NOT GLOB 'https://motdang.net/c[mr]/p/*')" +
  /* a doodle titled ไปรษณีย์ or ตลาด is a drawing of one, not the place (2026-10-22) */
  " OR lp.url GLOB 'https://motdang.net/doodles/*')";
const PAGED_SQL = "(lp.url GLOB '*-p[0-9]*.html' OR lp.url GLOB '*/page-[0-9]*.html')";

function rankScore(o, names, tb) {
  let sc = "w.rank * (1.0 + 0.05 * min(k.evc, 10))";
  /* compared against lower(k.title), so folded the same way */
  names = names.map((nm) => String(nm).toLowerCase());
  if (names.length) {
    const piece = names.map(() => "instr(' · ' || replace(lower(k.title), ' — ', ' · ') || ' · ', ?) > 0").join(" OR ");
    /* A piece that starts with the words is the thing itself more often than
     * one that only carries them (Nan 2026-10-22: "efeo" put "Great buttressed
     * tree in the EFEO garden" over "EFEO Chiang Mai Centre"). */
    const starts = names.map(() => "instr(' · ' || replace(lower(k.title), ' — ', ' · '), ?) > 0").join(" OR ");
    const has = names.map(() => "instr(lower(k.title), ?) > 0").join(" OR ");
    /* A Mot Dang list named after the words ("พิพิธภัณฑ์ · Museums · …") is not
     * the thing itself; it counts as a page that carries them, like each place
     * of that kind, so the places are not buried under their own lists
     * (2026-10-22: "museum" put seven lists over the National Museum). The
     * shelf a query names still goes first (doorPick). */
    sc += ` * (CASE WHEN (${piece}) AND NOT ${DIR_SQL} THEN 3.0 WHEN (${starts}) AND NOT ${DIR_SQL} THEN 2.5` +
          ` WHEN ${has} THEN 2.0 ELSE 1.0 END)`;
    for (const nm of names) tb.push(` · ${nm} · `);
    for (const nm of names) tb.push(` · ${nm}`);
    for (const nm of names) tb.push(nm);
  }
  /* Every word of a longer search in a place's title: "Chiang Mai University
   * library" is the Chiang Mai University Main Library, not the Libraries
   * list (2026-10-22). Each word found counts; lists take no part. */
  const cover = (o.cover || []).slice(0, 6);
  if (cover.length >= 2) {
    const sum = cover.map(() => "(instr(lower(k.title), ?) > 0)").join(" + ");
    sc += ` * (CASE WHEN ${DIR_SQL} THEN 1.0 ELSE 1.0 + 0.8 * ((${sum}) = ${cover.length}) END)`;
    for (const w of cover) tb.push(w);
  }
  /* Page 2 onward of a list repeats page 1's heading: 95 of 400 top-ten
   * slots across 40 kind searches on 2026-10-22, nine of ten for วัด. */
  sc += ` * (CASE WHEN ${DIR_SQL} AND ${PAGED_SQL} THEN 0.25 ELSE 1.0 END)`;
  if (o.pin) {
    /* Distance never sinks a page whose title carries the words: a place
     * asked for by name is the answer wherever the reader stands. And a
     * network guess (pin.exact false) can be a province off — on 2026-10-20 it
     * put a Chiang Mai connection in Phayao, 150 km out, and "tulou" ranked
     * Tulou Restaurant 15th of 15 under list pages with no pin — so under a
     * guess a pinned row keeps at least GUESS_FLOOR of an unpinned one. */
    const d = `${NEAR_BONUS} / (1.0 + max(0.0, ${nearSql(o.pin, "k")} - ${NEAR_FREE}) / ${NEAR_HALF})`;
    let dist = o.pin.exact ? d : `max(${GUESS_FLOOR}, ${d})`;
    if (names.length) {
      dist = `(CASE WHEN ${names.map(() => "instr(lower(k.title), ?) > 0").join(" OR ")} THEN max(1.0, ${d}) ELSE ${dist} END)`;
      for (const nm of names) tb.push(nm);
    }
    sc += ` * (CASE WHEN k.lat IS NULL THEN 1.0 ELSE ${dist} END)`;
  }
  for (const c of preferConds(o.prefer, "w.id", "k", "pf", tb)) sc += ` * (CASE WHEN ${c} THEN ${PREFER} ELSE 1.0 END)`;
  if ((o.prefer || []).some((g) => g.score)) sc += " * (1.0 + 0.06 * min(k.score, 10))";
  return sc;
}

/* What a reader asked for besides the thing (intents.js): one condition per
 * group — its words, a facet recorded on the place, a schedule open at the
 * asked-for time, a has-bit, a page rather than a place. A row that meets a
 * group counts PREFER times; the others stay in the answer after it. Binds go
 * into `tb` in the order the conditions are written. */
const PREFER = 2.5;
function preferConds(groups, idCol, keysAs, pagesAs, tb) {
  const out = [];
  for (const g of groups || []) {
    const or = [];
    if (g.match) { or.push(`${idCol} IN (SELECT rowid FROM fts WHERE fts MATCH ?)`); tb.push(g.match); }
    for (const f of g.fac || []) { or.push(`instr(coalesce(${pagesAs}.rich, ''), ?) > 0`); tb.push(`["${f}"`); }
    const sk = (g.sk || []).filter(Number.isInteger);
    if (sk.length) or.push(`${keysAs}.sk IN (${sk.join(",")})`);
    if (g.has && HAS[g.has]) or.push(`(${keysAs}.has & ${HAS[g.has]}) > 0`);
    if (g.page) or.push(`${keysAs}.kind <> 'place'`);
    if (or.length) out.push(`(${or.join(" OR ")})`);
  }
  return out;
}
const needsPages = (groups) => (groups || []).some((g) => g.fac && g.fac.length);

export function sql(match, opts) {
  const o = opts || {};
  const n = o.n || 10, offset = o.offset || 0;
  let sort = SORTS[o.sort] ? o.sort : "rank";
  if (SORTS[sort].needsPin && !o.pin) sort = "rank";
  if (SORTS[sort].needsEvents && !o.today) sort = "rank";
  const kf = keyFilters(o);
  const binds = [matchFor(match, o)].concat(kf.binds);
  const where = ["fts MATCH ?"].concat(kf.where);
  const join = kf.where.length ? " JOIN keys q ON q.id = fts.rowid" : "";
  /* The window count rides along with the rows: one statement answers both
   * "which ten" and "how many altogether". */
  const inner = `SELECT fts.rowid AS id, rank, count(*) OVER () AS total FROM fts${join}` +
                ` WHERE ${where.join(" AND ")} ORDER BY rank LIMIT ${n} OFFSET ${offset}`;
  const names = (o.names && o.names.length ? o.names : o.name ? [o.name] : []).filter(Boolean);
  const learned = o.learn && o.learn.size ? Array.from(o.learn).slice(0, 24) : [];
  const pinned = o.pins && o.pins.size ? Array.from(o.pins).slice(0, 8) : [];
  if (sort === "rank" && offset < RANK_WIN) {
    /* Only rowid and rank inside the window: reading fts.title_s there pulled
     * the stored text of every match before the cut — 3.4 s on D1 for ร้าน
     * (80,478 matches) against 85 ms without it. The title comes from keys. */
    const win = `SELECT fts.rowid AS id, rank, count(*) OVER () AS total FROM fts${join}` +
                ` WHERE ${where.join(" AND ")} ORDER BY rank LIMIT ${RANK_WIN}`;
    const tb = [];
    let sc = rankScore(o, names, tb);
    /* What people tapped for these words (findlearn.js): a bounded multiplier
     * on the page's own score, read by address because ids are renumbered by
     * every reload. 1.25 at most, so it never lifts a page past a title tier. */
    let lj = " JOIN pages lp ON lp.id = w.id";
    if (learned.length) {
      sc += ` * (CASE lp.url ${learned.map(() => "WHEN ? THEN ?").join(" ")} ELSE 1.0 END)`;
      for (const [u, m] of learned) tb.push(u, m);
      lj = " JOIN pages lp ON lp.id = w.id";
    }
    /* Pages the meaning search found too (findmeaning.js), by address. */
    const sem = o.sem && o.sem.size ? Array.from(o.sem).slice(0, 20) : [];
    if (sem.length) {
      sc += ` * (CASE lp.url ${sem.map(() => "WHEN ? THEN ?").join(" ")} ELSE 1.0 END)`;
      for (const [u, m] of sem) tb.push(u, m);
      lj = " JOIN pages lp ON lp.id = w.id";
    }
    /* A page Nan put first for these words (findpins.js). */
    if (pinned.length) {
      sc += ` * (CASE lp.url ${pinned.map(() => "WHEN ? THEN ?").join(" ")} ELSE 1.0 END)`;
      for (const [u, m] of pinned) tb.push(u, m);
      lj = " JOIN pages lp ON lp.id = w.id";
    }
    if (needsPages(o.prefer)) lj += " JOIN pages pf ON pf.id = w.id";
    return { text: `SELECT ${COLS}, f.total` +
                   ` FROM (SELECT w.id, w.total, ${sc} AS sc FROM (${win}) w JOIN keys k ON k.id = w.id${lj}` +
                   ` ORDER BY sc, w.id LIMIT ${n} OFFSET ${offset}) f` +
                   ` JOIN pages p ON p.id = f.id JOIN keys k ON k.id = f.id ORDER BY f.sc, f.id`,
             binds: tb.concat(binds) };   // the score's ? come first in the text
  }
  if (sort === "rank") {
    return { text: `SELECT ${COLS}, f.total` +
                   ` FROM (${inner}) f JOIN pages p ON p.id = f.id JOIN keys k ON k.id = f.id` +
                   ` ORDER BY f.rank`, binds };
  }
  /* Any other order is taken over the window the reader can actually reach —
   * the best ${WINDOW} matches — not over one page of it and not over an
   * answer of 60,000 they can never page to. The ids are ordered through the
   * narrow keys table, so only the ten rows that survive are read whole. */
  const win = `SELECT fts.rowid AS id, count(*) OVER () AS total FROM fts${join}` +
              ` WHERE ${where.join(" AND ")} ORDER BY rank LIMIT ${WINDOW}`;
  /* Nearest orders the rows that answer the words — in the title or the
   * address — and puts the pages that only mention them after: "khao soi"
   * nearest was a fishball shop, a ramen bar and a cooking school. */
  if (sort === "near" && !o.fields) {
    /* What the reader asked for besides the thing (wifi, halal, open late)
     * orders next, ahead of the distance. */
    const pb = [];
    const pc = preferConds(o.prefer, "s.id", "s", "pf", pb);
    const pr = pc.length ? `, (${pc.join(" + ")}) AS pr` : "";
    const po = pc.length ? "pr DESC, " : "";
    const pj = needsPages(o.prefer) ? " JOIN pages pf ON pf.id = s.id" : "";
    return {
      text: `SELECT ${COLS}, w.total` +
            ` FROM (SELECT s.id, f.total, (s.id IN (SELECT rowid FROM fts WHERE fts MATCH ?)) AS g${pr}` +
            ` FROM (${win}) f JOIN keys s ON s.id = f.id${pj}` +
            ` ORDER BY g DESC, ${po}${orderBy(sort, o, "s", "s")} LIMIT ${n} OFFSET ${offset}) w` +
            ` JOIN pages p ON p.id = w.id JOIN keys k ON k.id = w.id` +
            ` ORDER BY w.g DESC, ${po && "w." + po}${orderBy(sort, o, "k", "p")}`,
      binds: [`{title_s url_s} : (${match})`].concat(pb, binds),
    };
  }
  return {
    text: `SELECT ${COLS}, w.total` +
          ` FROM (SELECT s.id, f.total FROM (${win}) f JOIN keys s ON s.id = f.id` +
          ` ORDER BY ${orderBy(sort, o, "s", "s")} LIMIT ${n} OFFSET ${offset}) w` +
          ` JOIN pages p ON p.id = w.id JOIN keys k ON k.id = w.id` +
          ` ORDER BY ${orderBy(sort, o, "k", "p")}`,
    binds,
  };
}

/* The shelf a query names. "massage" is the massage shelf, "map" the map,
 * "coffee" the café shelf — and that page goes first and is where Lucky
 * lands, ahead of a tag page or a single shop. Two small asks: Mot Dang
 * addresses shaped like a shelf, a site page or a minisite with the words as
 * their slug (/cm/food/index.html, /map.html, /sites/safety/), and Mot Dang
 * lists whose title carries them (Coffee & Cafés). doorPick() decides which,
 * if any, the query names. */
export function doorSql(forms, said) {
  /* Addresses: up to four one-word Latin forms (massage, spa, cafe). Titles:
   * only what the reader said, since every variant is one more posting list. */
  const slugs = Array.from(new Set(forms.map((f) => norm(f).replace(/ /g, "-")).filter((f) => /^[a-z0-9][a-z0-9-]*$/.test(f)))).slice(0, 4);
  const words = Array.from(new Set((said || forms).map((f) => phrase(f, null, false)).filter(Boolean))).slice(0, 3);
  const out = [];
  const pick = (where, lim) => `SELECT ${COLS}, 0 AS total FROM (SELECT fts.rowid AS id, rank FROM fts JOIN keys q ON q.id = fts.rowid` +
    ` WHERE fts MATCH ? AND q.site = 'motdang' AND ${where} ORDER BY rank LIMIT ${lim}) f` +
    ` JOIN pages p ON p.id = f.id JOIN keys k ON k.id = f.id ORDER BY f.rank`;
  if (slugs.length) {
    const ph = slugs.map((sl) => sl.replace(/-/g, " ")).flatMap((sl) => [`"${sl} index html"`, `"net ${sl} html"`, `"net sites ${sl}"`,
                                                                         `"tag ${sl} html"`]);
    out.push({ text: pick("q.kind IN ('list', 'page')", 40), binds: [`url_s : (${ph.join(" OR ")})`] });
  }
  if (words.length) {
    out.push({ text: pick("q.kind = 'list'", 60), binds: [`(title_s : (${words.join(" OR ")}))${DROP}`] });
  }
  return out;
}

const CITY = { cm: { lat: 18.7883, lon: 98.9853 }, cr: { lat: 19.9105, lon: 99.8406 } };
/* A city said last ("museum chiang rai", "วัดเชียงราย"). Said first it is
 * usually part of a name: Chiang Mai University, Chiang Mai National Museum. */
const CITY_WORDS = [["cm", /(^|\s|(?<=[\u0e00-\u0e7f]))(chiang\s?mai|cnx|เชียงใหม่)$/i],
                    ["cr", /(^|\s|(?<=[\u0e00-\u0e7f]))(chiang\s?rai|cei|เชียงราย)$/i]];
/* The city a query names besides the thing, and the thing without it. */
export function cityOf(q) {
  const t = String(q || "").trim();
  for (const [city, re] of CITY_WORDS) {
    if (!re.test(t)) continue;
    const rest = t.replace(re, "").replace(/\s+/g, " ").trim();
    return rest && !CITY_WORDS.some(([, r]) => r.test(rest)) ? { city, rest } : null;
  }
  return null;
}
const DOOR_PATH = [
  [/^\/(cm|cr)\/([a-z0-9-]+)\/(?:index\.html)?$/, 100],               // a shelf
  [/^\/(cm|cr)\/[a-z0-9-]+\/([a-z0-9-]+)\/(?:index\.html)?$/, 96],     // a shelf inside one
  [/^\/()([a-z0-9-]+)\.html$/, 100],                                  // a page of the site: /map.html
  [/^\/()sites\/([a-z0-9-]+)\/(?:index\.html)?$/, 94],                 // a minisite
  /* a kind with no shelf of its own (karaoke, locksmith, mosque) has a tag
   * page; its plain one, not a tag crossed with a shelf or a district */
  [/^\/(cm|cr)\/tag\/((?!.*--)(?!.*-p\d+$)[a-z0-9-]+)\.html$/, 92],
];
const sing = (w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

export function doorPick(rows, forms, pin) {
  const want = new Set();
  for (const f of forms) { const n = norm(f); if (n) { want.add(n); want.add(sing(n)); } }
  if (!want.size) return null;
  let best = null, bestS = 0;
  for (const r of rows) {
    let path;
    try { path = new URL(r.url).pathname; } catch { continue; }
    if (/\/tag\//.test(path) && !/^\/(cm|cr)\/tag\/[a-z0-9-]+\.html$/.test(path)) continue;
    let s = 0, city = "";
    for (const [re, w] of DOOR_PATH) {
      const m = re.exec(path);
      if (!m) continue;
      city = m[1];
      const slug = m[2];
      const head = String(r.title || "").split(/ · | — /);
      /* The shelf's own names: its address, then the Thai and English heads of
       * its title ("นวด-สปา เชียงใหม่ · Massage & Spa, Chiang Mai"), each split
       * on - and &, the city taken off. */
      const names = [slug, slug.replace(/-/g, " ")];
      for (const h of head.slice(0, 2)) {
        const bare = h.replace(/,? *(Chiang Mai|Chiang Rai)$/i, "").replace(/ *(เชียงใหม่|เชียงราย)$/, "")
                      .replace(/ .*$/u, (x) => (/[฀-๿]/.test(h) ? "" : x));
        names.push(bare, ...bare.split(/ *[-&,] */));
      }
      const hit = names.map((x) => sing(norm(x))).filter(Boolean);
      if (hit.some((x) => want.has(x))) s = w - (hit.indexOf(hit.find((x) => want.has(x))) > 1 ? 2 : 0);
      break;
    }
    if (!s) continue;
    /* A city the reader named: only that city's shelves. */
    if (pin && pin.stated && city !== pin.city) continue;
    /* Two cities carry the same shelf: the reader's nearer one, else Chiang Mai. */
    if (city) {
      const near = pin ? (metres(pin, CITY.cr) < metres(pin, CITY.cm) ? "cr" : "cm") : "cm";
      if (city === near) s += 3;
    }
    if (s > bestS) { best = r; bestS = s; }
  }
  return bestS >= 90 ? best : null;
}

/* Every count the bar shows, in one pass over the answer: grouped by site,
 * type and section, with the date buckets and the has-counts summed inside
 * each group. The site, type and section filters stay OUT of the WHERE so each
 * of those facets can count its own options with the others applied —
 * facetsFrom() does that sum. The date filter stays out too (its buckets are
 * counted without it) and comes back as `nd`, the count with it applied. The
 * has-filters are in the WHERE: the count beside an unticked option is what
 * ticking it gives. The query's own site: terms stay in the match. */
export function facetSql(match, opts, today) {
  const o = opts || {};
  const t = today instanceof Date ? today : new Date(`${o.today || "2026-01-01"}T00:00:00Z`);
  const day = (k) => new Date(t.getTime() - k * 86400000).toISOString().slice(0, 10);
  /* Dates go in as literals: every one of them has passed ISO_DAY, and the
   * same condition is repeated in six sums. */
  const lit = (d) => (ISO_DAY.test(d || "") ? `'${d}'` : null);
  const dconds = [];
  if (lit(o.from)) dconds.push(`q.lastmod >= ${lit(o.from)}`);
  if (lit(o.to)) dconds.push(`q.lastmod <= ${lit(o.to)}`);
  const dok = dconds.length ? `(${dconds.join(" AND ")})` : "1";
  const sums = [`sum(${dok}) AS nd`];
  for (const h of ["photo", "contact", "toilet", "hours"]) sums.push(`sum(${dok} AND (q.has & ${HAS[h]}) > 0) AS h_${h}`);
  sums.push(`sum(${dok} AND (q.has & ${HAS.events}) > 0 AND q.evu >= ${lit(o.today) || "'9999-12-31'"}) AS h_events`);
  sums.push(`sum(${dok} AND ${openSql(o.open)}) AS h_open`);
  const kf = keyFilters(o, { date: true, kind: true, sec: true });
  return {
    text: `SELECT q.site, q.host, q.kind, q.sec, count(*) AS n, sum(q.lastmod >= ?) AS d7,` +
          ` sum(q.lastmod >= ?) AS d30, sum(q.lastmod >= ?) AS d365, ${sums.join(", ")}` +
          ` FROM fts JOIN keys q ON q.id = fts.rowid WHERE ${["fts MATCH ?"].concat(kf.where).join(" AND ")}` +
          ` GROUP BY q.site, q.host, q.kind, q.sec`,
    binds: [day(7), day(30), day(365), matchFor(match, { ...o, sites: o.qsites || [] }), ...kf.binds],
  };
}

/* The groups → the numbers each row of the bar prints. */
export function facetsFrom(groups, st) {
  const siteOk = (g) => !st.site || st.site === g.site || st.site === g.host;
  const kindOk = (g) => !st.kind || g.kind === st.kind;
  const secOk = (g) => !st.sec || g.sec === st.sec;
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + Number(v || 0));
  const sites = new Map(), hostOf = new Map(), kinds = new Map(), secs = new Map();
  const dates = { "7d": 0, "30d": 0, "1y": 0, all: 0 };
  const has = {};
  for (const h of HAS_KEYS) has[h] = 0;
  let total = 0;
  for (const g of groups || []) {
    if (kindOk(g) && secOk(g)) { add(sites, g.site, g.nd); hostOf.set(g.site, g.host); }
    if (siteOk(g) && secOk(g)) add(kinds, g.kind || "page", g.nd);
    if (siteOk(g) && kindOk(g) && g.sec) add(secs, g.sec, g.nd);
    if (siteOk(g) && kindOk(g) && secOk(g)) {
      dates["7d"] += Number(g.d7 || 0); dates["30d"] += Number(g.d30 || 0);
      dates["1y"] += Number(g.d365 || 0); dates.all += Number(g.n || 0);
      for (const h of HAS_KEYS) has[h] += Number(g["h_" + h] || 0);
      total += Number(g.nd || 0);
    }
  }
  const sorted = (m) => Array.from(m.entries()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return {
    sites: sorted(sites).map(([site, n]) => ({ site, host: hostOf.get(site), n })),
    kinds: Object.fromEntries(sorted(kinds)),
    secs: sorted(secs).slice(0, 10),
    dates, has, total,
    total0: Array.from(sites.values()).reduce((a, n) => a + n, 0),
  };
}

/* Kept for the old callers and tests: the site counts alone, and the date
 * buckets alone. The page itself asks facetSql(). */
export function siteFacetSql(match, opts) {
  const o = { ...(opts || {}), sites: [] };
  const binds = [narrow(match, o)];
  const where = ["fts MATCH ?"];
  if (o.from) { where.push("q.lastmod >= ?"); binds.push(o.from); }
  if (o.to) { where.push("q.lastmod <= ?"); binds.push(o.to); }
  return { text: `SELECT q.site, q.host, count(*) AS n FROM fts JOIN keys q ON q.id = fts.rowid` +
                 ` WHERE ${where.join(" AND ")} GROUP BY q.site, q.host ORDER BY n DESC`, binds };
}

export function dateFacetSql(match, opts, today) {
  const o = { ...(opts || {}), from: "", to: "" };
  const day = (k) => new Date(today.getTime() - k * 86400000).toISOString().slice(0, 10);
  return {
    text: `SELECT count(*) AS n, sum(q.lastmod >= ?) AS d7, sum(q.lastmod >= ?) AS d30,` +
          ` sum(q.lastmod >= ?) AS d365 FROM fts JOIN keys q ON q.id = fts.rowid WHERE fts MATCH ?`,
    binds: [day(7), day(30), day(365), narrow(match, o)],
  };
}

/* The facet groups do not depend on the sort, the page or the page size, and
 * over a huge answer they are most of the work (ร้าน, 80,478 pages: 930 ms of
 * 1.3 s on D1). Kept per isolate, so paging and re-sorting do not count again. */
const FACETS = new Map();
const FACETS_MAX = 300;

async function run(db, match, opts, facets, today, st) {
  const main = sql(match, opts);
  const stmts = [db.prepare(main.text).bind(...main.binds)];
  let fkey = null, groups = null;
  if (facets) {
    const f = facetSql(match, opts, today);
    fkey = f.text + "\u0000" + JSON.stringify(f.binds);
    const hit = FACETS.get(fkey);
    if (hit && Date.now() - hit.at < CACHE_S * 1000) groups = hit.groups;
    else stmts.push(db.prepare(f.text).bind(...f.binds));
  }
  const res = stmts.length > 1 ? await db.batch(stmts) : [await stmts[0].all()];
  const rows = (res[0].results) || [];
  if (facets && !groups && res[1]) {
    groups = res[1].results || [];
    if (FACETS.size >= FACETS_MAX) FACETS.delete(FACETS.keys().next().value);
    FACETS.set(fkey, { at: Date.now(), groups });
  }
  return {
    rows,
    total: rows.length ? Number(rows[0].total) : 0,
    facets: facets && groups ? facetsFrom(groups, st) : null,
  };
}

/* ------------------------------------------------------------ near spellings
 * The loose step, taken when the stricter ones find nothing or nearly
 * nothing. A Latin word the index holds on fewer than RARE pages is compared
 * with the index's own vocabulary (fts_v, an fts5vocab view of the FTS table,
 * made by fleetsearch/load.py): bounded edit distance with a swap counted as
 * one edit, and searchcore's romanisation key, so massge finds massage and
 * kow soi finds khao soi. Only the words starting the way the typed one does
 * (or with its first two letters swapped, or with another romanisation of its
 * first consonant) are read, and each slice is kept for the life of the
 * isolate. A Thai word goes to the segmenter's own repair, which compares
 * homophone keys (ศ/ษ/ส, ณ/น) against the dictionary. */
const RARE = 3;
const ROMAN = [["kh", "k", "g"], ["ph", "p", "b"], ["th", "t", "d"], ["ch", "c", "j"]];
let VOCAB = new Map(), VOCAB_AT = 0;

function prefixes(w) {
  const out = new Set([w.slice(0, 2), w[1] + w[0]]);
  for (const cls of ROMAN) {
    const lead = cls.find((c) => w.startsWith(c));
    if (!lead) continue;
    const rest = w.slice(lead.length);
    for (const c of cls) out.add((c + rest).slice(0, 2));
  }
  return Array.from(out).filter((p) => /^[a-z]{2}$/.test(p));
}

const bump = (p) => p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);

export async function nearSpell(db, items, seg) {
  const fix = {};
  const latin = Array.from(new Set(items.filter((it) => it.plain && /^[a-z]{4,24}$/i.test(it.text))
                                        .map((it) => it.text.toLowerCase())));
  if (latin.length) {
    try {
      if (Date.now() - VOCAB_AT > CACHE_S * 1000) { VOCAB = new Map(); VOCAB_AT = Date.now(); }
      const own = await db.prepare(`SELECT term, doc FROM fts_v WHERE term IN (${latin.map(() => "?").join(",")})`)
                          .bind(...latin).all();
      const docs = new Map((own.results || []).map((r) => [r.term, Number(r.doc)]));
      const need = latin.filter((w) => (docs.get(w) || 0) < RARE);
      const want = Array.from(new Set(need.flatMap(prefixes))).filter((p) => !VOCAB.has(p));
      if (want.length) {
        const res = await db.batch(want.map((p) => db.prepare(
          "SELECT term, doc FROM fts_v WHERE term >= ? AND term < ? AND doc >= ? AND length(term) BETWEEN 3 AND 26").bind(p, bump(p), RARE)));
        want.forEach((p, k) => VOCAB.set(p, (res[k].results || []).map((r) => [r.term, Number(r.doc)])));
      }
      for (const w of need) {
        const cap = slack(w), key = loose(w);
        const found = [];
        for (const p of prefixes(w)) {
          for (const [term, doc] of VOCAB.get(p) || []) {
            if (term === w) continue;
            let d = edits(w, term, cap);
            if (d > cap && key.length >= 4 && loose(term) === key) d = 1;
            if (d <= cap) found.push([d, -doc, term]);
          }
        }
        found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const best = Array.from(new Set(found.filter((f) => f[0] === (found[0] || [])[0]).map((f) => f[2]))).slice(0, 2);
        if (best.length) fix[w] = best;
      }
    } catch { /* no vocabulary table yet: the loose step is skipped, not the search */ }
  }
  for (const it of items) {
    if (!it.plain || !seg || !/^[฀-๿]+$/.test(it.text) || !seg.nearest) continue;
    const near = seg.nearest(it.text);
    if (near && near !== it.text) fix[it.text] = [near];
  }
  /* The fix map is keyed by the text as typed, which is how planSimple asks. */
  const out = {};
  for (const it of items) {
    const f = fix[it.text] || fix[it.text.toLowerCase()];
    if (f) out[it.text] = f;
  }
  return out;
}

/* The words of a query that already stand on COMMON pages or more, read from
 * the vocabulary in one lookup. */
const COMMON = 20000;
/* term → pages, kept for the isolate's life (and dropped with the counts):
 * the vocabulary only changes when the index is reloaded. */
let DOCN = new Map(), DOCN_AT = 0;
async function commonWords(db, q, seg) {
  const out = new Set();
  const terms = new Map();
  for (const t of tokenise(q, false)) {
    if (t.kind !== "term" || t.field || t.quoted || t.prefix || t.sign === "-") continue;
    const toks = spaceThai(t.text, seg).toLowerCase().split(" ").filter(Boolean);
    if (toks.length === 1) terms.set(toks[0], t.text);
  }
  if (!terms.size) return out;
  try {
    if (Date.now() - DOCN_AT > CACHE_S * 1000) { DOCN = new Map(); DOCN_AT = Date.now(); }
    const keys = Array.from(terms.keys()).slice(0, 12);
    const ask = keys.filter((k) => !DOCN.has(k));
    if (ask.length) {
      const r = await db.prepare(`SELECT term, doc FROM fts_v WHERE term IN (${ask.map(() => "?").join(",")})`).bind(...ask).all();
      for (const k of ask) DOCN.set(k, 0);
      for (const row of r.results || []) DOCN.set(row.term, Number(row.doc));
    }
    for (const k of keys) if (DOCN.get(k) >= COMMON) out.add(terms.get(k));
  } catch { /* no vocabulary table: every word is widened */ }
  return out;
}

/* The week schedules (keys.sk → minute intervals) and the English beside each
 * section name, read once per isolate and kept as long as the counts are. */
let AUX = null, AUX_AT = 0;
async function aux(db) {
  if (AUX && Date.now() - AUX_AT < CACHE_S * 1000) return AUX;
  const out = { scheds: new Map(), secEn: {} };
  try {
    /* sec_en travels in ordered ~45 KB pieces (sec_en:000, :001, …) because
     * the whole map is past D1's per-statement limit; joined back here. */
    const [s, m] = await db.batch([db.prepare("SELECT k, iv FROM scheds"),
                                   db.prepare("SELECT v FROM meta WHERE k LIKE 'sec_en:%' ORDER BY k")]);
    for (const r of s.results || []) {
      try { out.scheds.set(Number(r.k), JSON.parse(r.iv)); } catch { /* one bad row is one lamp */ }
    }
    const blob = (m.results || []).map((r) => r.v).join("");
    if (blob) { try { out.secEn = JSON.parse(blob); } catch { /* a torn map is no English, not a crash */ } }
  } catch { /* an index loaded before these tables existed: no lamps, no English */ }
  AUX = out; AUX_AT = Date.now();
  return AUX;
}

export function openIds(scheds, minute) {
  const ids = [];
  for (const [k, iv] of scheds) if (openAt(iv, minute)) ids.push(k);
  return ids;
}

let COUNTS = null, COUNTS_AT = 0;
async function counts(db) {
  if (COUNTS && Date.now() - COUNTS_AT < CACHE_S * 1000) return COUNTS;
  const [sites, meta] = await db.batch([
    db.prepare("SELECT site, host, count(*) AS n FROM keys GROUP BY site, host ORDER BY n DESC"),
    db.prepare("SELECT k, v FROM meta"),
  ]);
  const m = {};
  for (const r of meta.results || []) m[r.k] = r.v;
  COUNTS = { sites: sites.results || [], meta: m,
             total: (sites.results || []).reduce((a, r) => a + Number(r.n), 0) };
  COUNTS_AT = Date.now();
  return COUNTS;
}

/* ------------------------------------------------------------ the register
 * data/sites.json (built by sites_layer.py from data/curated/sites.json, plus the
 * fleet roster) — every minisite and tool, with the words a reader might type.
 * Read from R2 once per isolate and again after SITES_TTL, so a site the walk
 * publishes answers here without this Worker being redeployed, and without the
 * page index being reloaded. A match stands above the page hits. */
const SITES_TTL = 10 * 60 * 1000;
let SITES = null, SITES_AT = 0;
async function siteRows(env) {
  if (SITES && Date.now() - SITES_AT < SITES_TTL) return SITES;
  try {
    const o = await cachedGet(env, "data/sites.json");
    if (o) { SITES = (await o.json()).sites || []; SITES_AT = Date.now(); }
  } catch { /* the old copy, or none: page hits still answer */ }
  return SITES || [];
}

const fold = (s) => String(s || "").toLowerCase().normalize("NFKC")
  .replace(/[\u2019']/g, "").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

/* Score each site against the query. A name said whole wins; otherwise every
 * Latin word of the query has to land somewhere in the card (name, line or its
 * words), and a Thai run has to appear inside one of them. Three at most. */
const STOP = new Set(["the", "of", "and", "to", "in", "on", "for", "by", "at", "an", "is", "my", "me"]);
export function siteMatch(q, rows, max = 3) {
  const fq = fold(q);
  if (!fq || fq.length < 2) return [];
  const toks = fq.split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  const out = [];
  for (const r of rows) {
    const names = [fold(r.en), fold(r.th)].filter(Boolean);
    const words = (r.w || []).map(fold);
    const hay = " " + [...names, fold(r.le), fold(r.lt), ...words].join(" ") + " ";
    let score = 0;
    if (names.includes(fq) || words.includes(fq)) score = 100;
    else if (names.some((n) => n.length > 3 && (n.includes(fq) && fq.length > 3))) score = 60;
    else if (toks.length && toks.every((t) => /[\u0e00-\u0e7f]/.test(t) ? hay.includes(t)
        : hay.includes(" " + t + (t.length >= 5 ? "" : " ")))) {
      score = 20 + toks.filter((t) => names.some((n) => n.includes(t))).length * 10;
    }
    if (score) out.push([score, r]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, max).map((x) => x[1]);
}

/* ------------------------------------------------------------ answers
 * Short sourced answers that stand above the results when a query asks one of
 * their questions. Each source is one JSON file on R2:
 *   sites/long-stay/answers.json   visa questions → Chiang Mai Visa Desk
 *                                  (long-stay/tools/answers.py; Nan, 2026-10-04)
 *   data/answers-health.json       care questions → Defiant
 *                                  (data/curated/answers_health.json; Nan, 2026-10-04)
 *   data/answers-compounds.json    a drug or compound by name → what it is, the Thai register,
 *                                  access, vetting (importers/answers_compounds.py; Nan, 2026-10-04)
 * Each answer gives the figure and its source, the pages that go further, and
 * the business that can do it, with its one-line disclosure. Read like the
 * register. The longest trigger said, across every source, wins; a query that
 * is only shaped like a source (its general answer) gets that answer. */
const ANSWER_KEYS = ["sites/long-stay/answers.json", "data/answers-compounds.json", "data/answers-health.json"];
let ANS = null, ANS_AT = 0;
async function answerDocs(env) {
  if (ANS && Date.now() - ANS_AT < SITES_TTL) return ANS;
  const docs = await Promise.all(ANSWER_KEYS.map(async (k) => {
    try { const o = await cachedGet(env, k); return o ? normAnswers(await o.json()) : null; } catch { return null; }
  }));
  if (docs.some(Boolean) || !ANS) { ANS = docs.filter(Boolean); ANS_AT = Date.now(); }
  return ANS;
}

/* The visa file predates the shared shape: lift its flat desk fields and its
 * page/office links into desk{} and go[]. */
function normAnswers(doc) {
  if (!doc || !Array.isArray(doc.answers)) return null;
  if (doc.desk && typeof doc.desk === "object") return doc;
  const deskLabel = (a, th) => /farang-buddy\/$/.test(a.d) ? (th ? "FarangBuddy แอปฟรีจดวันรายงานตัว" : "FarangBuddy, the free date tracker")
    : /us-visas\/$/.test(a.d) ? (th ? "วีซ่าอเมริกา 31 ประเภท" : "US visas, 31 categories") : "chiangmaivisadesk.com";
  return {
    read: doc.read, general: "visa", cls: "visa",
    desk: { name: doc.desk_name, line: doc.line, line_id: doc.line_id, does_en: doc.desk_does_en,
            does_th: doc.desk_does_th, disclose_en: doc.disclose_en, disclose_th: doc.disclose_th },
    answers: doc.answers.map((a) => Object.assign({}, a, {
      go: [{ th: "อยู่ยาว", en: "The Long Stay", u: a.u, u_th: a.u_th }]
        .concat(a.office ? [{ th: "ตม. เชียงใหม่", en: "Chiang Mai Immigration", u: a.office }] : []),
      d_label_en: deskLabel(a, false), d_label_th: deskLabel(a, true),
    })),
  };
}

export function answerMatch(q, docs) {
  const fq = " " + fold(q) + " ";
  if (!docs || fq.trim().length < 2) return null;
  const said = (w) => {
    const fw = fold(w);
    if (!fw) return 0;
    if (/[\u0e00-\u0e7f]/.test(fw)) return fw.length >= 3 && fq.includes(fw) ? fw.length : 0;
    return fq.includes(" " + fw + " ") ? fw.length : 0;
  };
  let best = null, len = 0, general = null;
  for (const doc of docs) {
    for (const a of doc.answers) {
      for (const w of a.w || []) {
        const n = said(w);
        if (!n) continue;
        if (a.id === doc.general) { if (!general) general = { a, doc }; continue; }
        if (n > len) { best = { a, doc }; len = n; }
      }
    }
  }
  if (best || general) return best || general;
  /* A compound file (fuzzy: true) forgives one slip in a long name, two in a very long
   * one: "retatrutid", "semaglutid", "tirzapatide". Single-word triggers only. */
  const toks = fq.trim().split(" ").filter((t) => t.length >= 6 && !/[\u0e00-\u0e7f]/.test(t));
  let near = null, nd = 9;
  for (const doc of docs) {
    if (!doc.fuzzy) continue;
    for (const a of doc.answers) {
      for (const w of a.w || []) {
        const fw = fold(w);
        if (fw.length < 6 || fw.includes(" ")) continue;
        for (const t of toks) {
          if (Math.abs(t.length - fw.length) > 2) continue;
          const lim = fw.length >= 9 ? 2 : 1;
          const dd = editDistance(t, fw, lim);
          if (dd <= lim && dd < nd) { near = { a, doc, fuzzy: w }; nd = dd; }
        }
      }
    }
  }
  return near;
}

/* Levenshtein with an early stop past `lim`. */
function editDistance(a, b, lim) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > lim) return lim + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* kept for callers and tests written against the visa file alone */
export function visaMatch(q, doc) {
  const n = normAnswers(doc);
  const hit = n ? answerMatch(q, [n]) : null;
  return hit ? hit.a : null;
}

function answerPanel(hit, q) {
  if (!hit) return "";
  const { a, doc } = hit;
  const th = /[\u0e00-\u0e7f]/.test(q);
  const pick = (t, e) => (th ? t || e : e || t);
  const D = doc.desk;
  const src = (a.src || [])[0];
  const go = (a.go || []).map((g) => `<a href="${esc(pick(g.u_th, g.u))}">${esc(g.th)} · ${esc(g.en)} →</a>`).join(" ");
  return `<div class="visa ans-${esc(doc.cls || "x")}"><b class="vh">${esc(a.th)} · ${esc(a.en)}</b>`
    + `<p class="va">${esc(pick(a.a_th, a.a_en))}</p>`
    + (doc.read || src ? `<p class="vs">${doc.read ? esc(pick("อ่านเมื่อ ", "Read ")) + esc(dmy(doc.read)) : ""}`
      + (src ? `${doc.read ? " · " : ""}<a href="${esc(src[0])}" rel="nofollow noopener">${esc(src[1])}</a>` : "") + `</p>` : "")
    + (go ? `<p class="vgo">${go}</p>` : "")
    + `<div class="vd"><b>${esc(D.name)}</b>`
    + (a.desk ? ` <span class="vdo">${esc(pick(D.does_th, D.does_en))}</span>` : "")
    + `<span class="vrow">`
    + (D.line ? `<a class="vline" href="${esc(D.line)}" rel="noopener">LINE ${esc(D.line_id)}</a>` : "")
    + (a.d ? `<a class="vweb" href="${esc(pick(a.d_th, a.d))}" rel="noopener">${esc(pick(a.d_label_th, a.d_label_en) || a.d.replace(/^https:\/\//, ""))} →</a>` : "")
    + `</span><small>${esc(pick(D.disclose_th, D.disclose_en))}</small></div></div>`;
}

function siteCards(hits) {
  if (!hits.length) return "";
  return `<div class="sitecards">${hits.map((r) => `<a class="sc" href="${esc(r.u)}">`
    + `<b>${esc(r.th)}${r.th && r.en ? " · " : ""}${esc(r.en)}</b>`
    + (r.lt || r.le ? `<span>${esc(r.lt)}${r.lt && r.le ? " · " : ""}${esc(r.le)}</span>` : "")
    + `<small>${esc(r.u.replace(/^https:\/\//, ""))}</small></a>`).join("")}`
    + `<p class="m"><a href="/sites/">ทุกเว็บ · every site →</a></p></div>`;
}

/* ------------------------------------------------------------ the page */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => Number(n).toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1] || m[2]}-${m[1]}` : "";
}

const CSS = `
:root{--paper:#fffdf8;--ink:#1a1408;--mute:#5c4d38;--rule:#c9b895;--red:#b3261e}
html{background:var(--paper);color:var(--ink);font:17px/1.5 Georgia,"Times New Roman",Thonburi,serif}
body{margin:0;padding:0 1rem 3rem;max-width:64em}
a{color:#0000ee}a:visited{color:#551a8b}
header{display:flex;align-items:baseline;gap:1.2em;flex-wrap:wrap;padding:.8em 0 .4em;border-bottom:1px solid var(--rule)}
.logo{color:var(--red);text-decoration:none;font-weight:bold;font-size:1.35em;white-space:nowrap}
.logo small{color:var(--mute);font-weight:normal;font-size:.62em;letter-spacing:.12em;margin-left:.4em}
nav a{margin-right:1em}nav .on{color:var(--ink);text-decoration:none;font-weight:bold}
.doors{display:inline-flex;gap:.35em;margin-left:auto}
.door{display:inline-flex;align-items:center;justify-content:center;width:2.2em;height:2.2em;border:1px solid var(--rule);border-radius:50%;background:#fff;color:var(--ink)}
.door .ic{width:1.25em;height:1.25em}
.langs{display:inline-flex}.langs button{margin:0;padding:.2em .6em;font-size:.85em;border-radius:0}
.langs button:first-child{border-radius:1em 0 0 1em}.langs button:last-child{border-radius:0 1em 1em 0;border-left:0}
.langs button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
form.q{margin:1em 0 .4em}
input[type=search],textarea{font:inherit;font-size:1.05em;width:100%;max-width:38em;padding:.35em .5em;border:1px solid var(--mute);background:#fff;color:var(--ink);box-sizing:border-box}
textarea{max-width:44em}
button,select,input[type=date]{font:inherit;padding:.3em .7em;margin:.3em .3em 0 0;background:#f2ebdc;border:1px solid var(--mute);color:var(--ink);cursor:pointer}
.tip{color:var(--mute);font-size:.9em;margin:.2em 0 1em}
.count{margin:1em 0 .2em}.note{color:var(--mute);margin:0 0 .6em}
ol{padding-left:2.2em;margin:.6em 0}li{margin:0 0 1em}
li a.t{font-size:1.08em}.d{color:#0b6b3a;font-size:.88em;white-space:nowrap}
#md-exact{font-size:.9em;padding:.15em .55em;margin-left:.4em}.u{color:#006621;font-size:.92em;word-break:break-all}.m{color:var(--mute);font-size:.88em}
.pages a,.pages b{margin-right:.55em}
/* Curation: Sort stays in view, the narrowers fold behind Refine, and every
 * option is a real chip you can tap — not a run of text links. */
.bar{margin:.5em 0 .9em;font-size:.95em}
.g{display:flex;flex-wrap:wrap;align-items:center;gap:.4em;margin:.35em 0}
.g b.k{color:var(--mute);font-weight:normal;font-size:.9em;display:inline-flex;align-items:center;gap:.3em;margin-right:.1em}
.bar span,.bar b.v{display:inline-flex;align-items:center;gap:.3em;margin:0;padding:.4em .75em;border:1px solid var(--rule);border-radius:1.3em;background:#fff;white-space:nowrap;line-height:1.15}
.bar span a{color:#0b57b3;text-decoration:none;display:inline-flex;align-items:center;gap:.3em}
.bar b.v{background:var(--ink);border-color:var(--ink);color:var(--paper);font-weight:normal}
.bar span.on{background:#eaf2ff;border-color:#0b57b3}.bar span.on a{color:#0b3e86}
.bar .n{color:var(--mute);font-size:.85em}.bar b.v .n{color:#d8cba8}
.ic{width:1.05em;height:1.05em;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.ic.open{stroke:#0b8a3a}.ic.chk{stroke:#0b57b3}
details.refine{margin:.45em 0 0}
details.refine>summary{display:inline-flex;align-items:center;gap:.4em;padding:.5em .95em;border:1px solid var(--mute);border-radius:1.3em;background:#f2ebdc;color:var(--ink);font-weight:bold;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent}
details.refine>summary::-webkit-details-marker{display:none}
details.refine>summary::after{content:"";width:.45em;height:.45em;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);margin:-.15em 0 0 .1em}
details.refine[open]>summary::after{transform:rotate(-135deg);margin-top:.1em}
details.refine>summary .onn{background:#0b57b3;color:#fff;border-radius:1em;padding:0 .5em;font-size:.85em;font-weight:normal}
.rf{margin:.4em 0 0;padding:.15em 0 .1em .7em;border-left:2px solid var(--rule)}
.loosen{margin:.2em 0 .8em;padding:.45em .7em;background:#fbf3d9;border:1px solid #d8b24a;border-radius:.5em;font-size:.93em}
.loosen a{display:inline-flex;align-items:center;gap:.25em;white-space:nowrap;margin-right:.5em}
@media(max-width:40em){.bar span,.bar b.v,details.refine>summary{padding:.5em .85em}.g b.k{width:100%;margin:0 0 .1em}}
.sites{columns:2;column-gap:2em;font-size:.95em}.sites p{margin:0 0 .25em;break-inside:avoid}
table.ops{border-collapse:collapse;font-size:.92em;margin:.6em 0 1em}table.ops td{padding:.15em .8em .15em 0;vertical-align:top}
footer{margin-top:2.5em;padding-top:.6em;border-top:1px solid var(--rule);color:var(--mute);font-size:.9em}
.r{display:flex;gap:.8em;align-items:flex-start}.r .b{min-width:0;flex:1}
.th{flex:none;position:relative;display:block;width:72px;height:72px;margin-top:.25em;border:1px solid var(--rule);background:#f2ebdc;overflow:hidden}
.th img{display:block;width:72px;height:72px}
.th i{position:absolute;width:10px;height:10px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--red);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.cr{font-size:.86em;color:var(--mute)}.cr a{color:var(--mute)}
.own{font-size:.78em;border:1px solid #c9b88a;border-radius:.7em;padding:0 .55em;margin-left:.4em;white-space:nowrap}.own .ic{width:1em;height:1em;vertical-align:-.15em;margin-right:.25em}.sem li{margin:.5em 0}.sem .abs{font-size:.9em}.rich{font-size:.9em;margin:.15em 0}.rich span{margin-right:.9em;white-space:nowrap}.rich .fa{letter-spacing:.12em}
@media(max-width:40em){.th,.th img{width:60px;height:60px}.r{gap:.6em}}
label{display:inline-block;margin-right:.8em}
@media(max-width:40em){.sites{columns:1}html{font-size:16px}}
.sitecards{margin:.8em 0 .4em}
.sc{display:block;margin:0 0 .55em;padding:.55em .8em;border:2px solid var(--red);border-radius:.6em;background:#fffaf0;text-decoration:none;color:var(--ink);max-width:38em}
.sc b{display:block;color:var(--red);font-size:1.08em}.sc span{display:block;font-size:.93em}.sc small{color:#006621}
.visa{margin:.8em 0 .6em;padding:.7em .9em;border:2px solid #24406E;border-radius:.6em;background:#f7f4ec;max-width:38em;box-shadow:3px 3px 0 #f1c40f}
.visa .vh{display:block;color:#24406E;font-size:1.12em}.visa .va{margin:.35em 0;line-height:1.5}
.visa .vs{font-size:.84em;color:var(--mute);margin:.2em 0}.visa .vs a{color:var(--mute)}
.visa .vgo a{display:inline-block;margin:.15em .8em .15em 0;font-weight:bold}
.visa .vd{margin-top:.5em;padding-top:.5em;border-top:1px dashed #b9b2a3}.visa .vd b{color:var(--red)}
.visa .vdo{font-size:.9em}.visa .vrow{display:block;margin:.35em 0}
.visa .vline,.visa .vweb{display:inline-block;margin:0 .5em .3em 0;padding:.3em .8em;border-radius:99px;text-decoration:none;color:#fff;font-weight:bold}
.visa .vline{background:#06c755}.visa .vweb{background:#2f4f3f}
.visa small{display:block;font-size:.8em;color:var(--mute);line-height:1.4}
.ans-health{border-color:#2f6f5f;background:#f5f8f4}.ans-health .vh{color:#2f6f5f}
.ans-health .vd b{color:#2f6f5f;font-weight:600}.ans-health .vdo{font-size:.86em;color:var(--mute)}
.ans-health .vline,.ans-health .vweb{padding:0;border-radius:0;background:none;color:#2f6f5f;font-weight:600;text-decoration:underline;margin-right:.9em}
/* The good / not-it line under the count (judgePanel). The ✓ ✕ on the rows
 * show only while "not it" is open. */
.jl{display:flex;flex-wrap:wrap;align-items:center;gap:.45em;margin:.2em 0 .7em;font-size:.93em}
.jl form{margin:0}.jl button{margin:0}
.jl .jg button,details.jf>summary{display:inline-flex;align-items:center;gap:.3em;padding:.35em .85em;border:1px solid var(--rule);border-radius:1.3em;background:#fff;color:var(--ink);cursor:pointer;font:inherit;list-style:none;-webkit-tap-highlight-color:transparent}
details.jf>summary::-webkit-details-marker{display:none}
details.jf[open]{flex-basis:100%}details.jf[open]>summary{background:#fbe9e4;border-color:var(--red)}
.jf form{margin:.5em 0 0;padding:.6em .8em;border:1px solid var(--rule);border-radius:.6em;background:#fffaf0;max-width:40em}
.jf .jw{display:flex;flex-wrap:wrap;gap:.35em;margin:0 0 .5em}
.jf .jw label,.jm label{position:relative;display:inline-flex;align-items:center;margin:0;padding:.3em .75em;border:1px solid var(--rule);border-radius:1.3em;background:#fff;cursor:pointer;white-space:nowrap}
.jf .jw input,.jm input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.jf .jw label:has(input:checked){background:var(--ink);border-color:var(--ink);color:var(--paper)}
.jf .jw label:has(input:focus-visible),.jm label:has(input:focus-visible){outline:2px solid #0b57b3;outline-offset:1px}
.jf input[name=want]{font:inherit;width:100%;padding:.35em .5em;border:1px solid var(--mute);background:#fff;color:var(--ink);box-sizing:border-box}
.jf .jh{color:var(--mute);margin:0 0 .5em;font-size:.95em}.jf button[type=submit]{margin:.5em 0 0}
.jm{display:none;gap:.3em;margin:0 0 0 .5em;vertical-align:.1em;font-size:.85em}
body:has(#jfd[open]) .jm{display:inline-flex}
.jm label{padding:.05em .6em}
.jm label.jy:has(input:checked){background:#0b8a3a;border-color:#0b8a3a;color:#fff}
.jm label.jn:has(input:checked){background:var(--red);border-color:var(--red);color:#fff}
.jok{color:#0b6b3a;margin:.2em 0 .7em}
`;

/* The front page's link card (assets/og/p/search.jpg, drawn by share-cards; Nan 2026-10-20). */
const FRONT_CARD = `<meta property="og:title" content="ค้นหา · Search">
<meta property="og:description" content="ค้นหา · Search — ตรรกะ · Boolean">
<meta property="og:image" content="https://motdang.net/og/p/search.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:alt" content="Card: ค้นหา · Search">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://motdang.net/og/p/search.jpg">
<meta name="twitter:image:alt" content="Card: ค้นหา · Search">
`;

function shell(title, body, robots, card = "") {
  return `<!DOCTYPE html><html lang="th" translate="no" class="notranslate"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google" content="notranslate">
<title>${esc(title)}</title>
<meta name="robots" content="${robots}">
${card}
<link rel="icon" href="/logo/motdang-favicon.svg" type="image/svg+xml">
<style>${CSS}${CAL_CSS}${QA_CSS}</style></head><body>
${body}
<script src="/locshare.js" defer></script>
<footer><a href="/">มดแดง Mot Dang</a> · <a href="/find">ค้นหา · search</a> · <a href="/find?adv=1">ตรรกะ · boolean</a> · <a href="/advanced.html">กรองสถานที่ · place filters</a> · <a href="/api/">API</a></footer>
${LANG_JS}
</body></html>`;
}

/* The site's top bar, in this page's own style: the logo, the two doors of
 * the search, the language, and the same four doors every other page carries
 * beside its search box — toilets, the map, the calendar, every site. */
const DOORS = [["/toilets.html", "i-loo", "ห้องน้ำใกล้ที่สุด · nearest toilet"],
               ["/map.html", "i-map", "แผนที่ · the map"],
               ["/calendar.html", "i-cal", "ปฏิทิน · what is on"],
               ["/sites/", "i-grid", "ทุกเว็บ · every site"]];
function head(adv) {
  const doors = DOORS.map(([href, icon, label]) =>
    `<a class="door" href="${href}" title="${label}" aria-label="${label}">${sicon(icon)}</a>`).join("");
  return `<header><a class="logo" href="/">มดแดง<small>MOT DANG</small></a>
<nav><a href="/find"${adv ? "" : ' class="on"'}>ค้นหา · Search</a><a href="/find?adv=1"${adv ? ' class="on"' : ""}>ตรรกะ · Boolean</a></nav>
<span class="doors">${doors}</span>
<span class="langs" role="group" aria-label="ภาษา · Language"><button type="button" data-lang="th">ไทย</button><button type="button" data-lang="en">EN</button></span></header>`;
}

/* The language: the site's own choice (localStorage md-lang, the key every
 * other page reads and writes), else the browser's; a crawler gets both. The
 * page is written with both, each "ไทย · English" pair in one piece of text,
 * so the switch keeps one side of each pair outside the results list and
 * leaves the rows as they were found. */
const LANG_JS = `<script>(function(){var d=document,r=d.documentElement,l;try{l=localStorage.getItem("md-lang")}catch(e){}
if(l!="th"&&l!="en")l=/bot|crawl|spider|slurp|preview|lighthouse/i.test(navigator.userAgent)?0:/^th/i.test(navigator.language)?"th":"en";
d.querySelectorAll(".langs button").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.lang==l);b.onclick=function(){try{localStorage.setItem("md-lang",b.dataset.lang)}catch(e){}location.reload()}});
if(!l)return;r.classList.add("lang-"+l);if(l=="en")r.lang="en";
var T=/[\\u0e00-\\u0e7f]/,w=d.createTreeWalker(d.body,4),n,a=[];while(n=w.nextNode())if(!n.parentNode.closest("ol,script,textarea,.cr,.sc")&&n.nodeValue.indexOf(" · ")>=0)a.push(n);
a.forEach(function(n){var p=n.nodeValue.split(" · "),o=[];for(var i=0;i<p.length;i++)if(T.test(p[i])&&p[i+1]&&!T.test(p[i+1])&&/[a-z]/i.test(p[i+1]))o.push(l=="th"?p[i]:p[++i]);else o.push(p[i]);n.nodeValue=o.join(" · ")})})()</script>`;

/* The box carries the filters in force as hidden fields, so typing a new
 * query keeps the site, the sort and the rest — and the bar is where they
 * come off again. */
function keep(st) {
  /* `since` is the preset and `from` is what it works out to, so only one of
   * them travels — otherwise the address carries today's date and tomorrow's
   * reader of a shared link gets a window that has stopped moving. */
  /* What the reader asked for, not what the box read into the query — "near
   * me" sorts by distance and "open now" filters, but a new query typed into
   * this box starts without them. */
  const sort = st.sortAsked !== undefined ? st.sortAsked : st.sort;
  return Object.entries({ site: st.site, sort: sort === "rank" ? "" : sort,
                          kind: st.kind, sec: st.sec, has: (st.hasAsked || st.has || []).join(","),
                          in: st.in === "all" ? "" : st.in, since: st.since,
                          from: st.since ? "" : st.from, to: st.since ? "" : st.to,
                          n: st.n === 10 ? "" : st.n,
                          near: st.pin && st.pin.exact ? `${st.pin.lat},${st.pin.lon}` : "" })
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
}

function simpleForm(q, st) {
  return `<form class="q" action="/find" method="get">
<input type="search" name="q" value="${esc(q)}" autofocus aria-label="ค้นหา · search">${keep(st)}
<button type="submit">ค้นหา · Search</button><button type="submit" name="lucky" value="1">ลองโชค · Lucky</button>
</form>
<p class="tip">+ต้องมี · −ไม่เอา · "วลี" · คำ* &nbsp;·&nbsp; +must −never "a phrase" word*</p>`;
}

function booleanForm(q, st, c) {
  const opts = (c ? c.sites : []).map((r) =>
    `<option value="${esc(r.site)}"${r.site === st.site ? " selected" : ""}>${esc(siteLabel(r))} (${num(r.n)})</option>`).join("");
  const sel = (name, label, items) =>
    `<label>${label} <select name="${name}">` +
    items.map(([v, text, on]) => `<option value="${esc(v)}"${on ? " selected" : ""}>${text}</option>`).join("") +
    `</select></label>`;
  /* The bar's Type, Section and Has have no dropdown here; they ride along. */
  const ride = Object.entries({ kind: st.kind, sec: st.sec, has: (st.has || []).join(",") })
    .filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
  return `<form class="q" action="/find" method="get"><input type="hidden" name="adv" value="1">${ride}
<label for="q">นิพจน์ · Boolean expression</label><br>
<textarea id="q" name="q" rows="3" autofocus>${esc(q)}</textarea><br>
<label>ไซต์ · site <select name="site"><option value="">ทุกไซต์ · all (${c ? num(c.total) : "…"})</option>${opts}</select></label>
${sel("in", "คำอยู่ที่ · words in", Object.keys(IN_COLS).map((k) =>
  [k === "all" ? "" : k, `${IN_LABEL[k][0]} · ${IN_LABEL[k][1]}`, st.in === k]))}
${sel("sort", "เรียง · sort", Object.entries(SORTS).map(([k, v]) =>
  [k === "rank" ? "" : k, v.en ? `${v.th} · ${v.en}` : v.th, st.sort === k]))}
<label>ตั้งแต่ · from <input type="date" name="from" value="${esc(st.from)}"></label>
<label>ถึง · to <input type="date" name="to" value="${esc(st.to)}"></label>
${sel("n", "ต่อหน้า · per page", PER_PAGE.map((k) => [k === 10 ? "" : k, String(k), st.n === k]))}
<button type="submit">ค้นหา · Search</button>
</form>
<table class="ops">
<tr><td><b>AND</b></td><td>ทั้งสองคำ · both — <i>ตอกเส้น AND นิมมาน</i></td></tr>
<tr><td><b>OR</b></td><td>คำใดคำหนึ่ง · either — <i>โยคะ OR pilates</i></td></tr>
<tr><td><b>NOT</b></td><td>ไม่มีคำนี้ · without — <i>massage NOT spa</i></td></tr>
<tr><td><b>NEAR</b></td><td>ห่างกันไม่เกิน ${NEAR_WORDS} คำ · within ${NEAR_WORDS} words — <i>elephant NEAR sanctuary</i></td></tr>
<tr><td><b>( )</b></td><td>จัดกลุ่ม · grouping — <i>(vegan OR เจ) AND cafe</i></td></tr>
<tr><td><b>"…"</b></td><td>วลีตรงตัว · exact phrase — <i>"tok sen"</i></td></tr>
<tr><td><b>คำ*</b></td><td>ขึ้นต้นด้วย · begins with — <i>dermat*</i></td></tr>
<tr><td><b>title:</b> <b>url:</b> <b>site:</b></td><td>เฉพาะชื่อหน้า · ที่อยู่ · ไซต์ — <i>title:ยันต์ site:wichaa.net</i></td></tr>
</table>`;
}

function sitesList(c) {
  if (!c || !c.sites.length) return "";
  const rows = c.sites.map((r) => {
    return `<p><a href="/find?site=${encodeURIComponent(r.site)}">${esc(siteLabel(r))}</a> (${num(r.n)})</p>`;
  }).join("");
  const when = c.meta.generated ? dmy(c.meta.generated) : "";
  return `<p class="count">${num(c.total)} หน้า จาก ${c.sites.length} ไซต์ · ${num(c.total)} pages from ${c.sites.length} sites${when ? ` · ${when}` : ""}</p><div class="sites">${rows}</div>`;
}

/* Every link on a results page carries the whole state, so a filter never
 * silently drops the query, the sort or the page size. Changing a filter
 * returns to page one: page seven of the old answer is not page seven of
 * the new one. */
function withParams(url, changes) {
  const u = new URL(url.toString());
  for (const [k, v] of Object.entries(changes)) {
    if (v === "" || v == null) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  u.searchParams.delete("lucky");
  if (!("p" in changes)) u.searchParams.delete("p");
  return esc(u.pathname + u.search);
}

/* Several sites share a host — muay-thai lives under motdang.net, and the
 * minisites under nanobotco.github.io — so a site that is not its host's own
 * home says host/site. Decided from the row alone: the old rule compared the
 * rows on screen, so a filtered page holding one site of a shared host fell
 * back to the bare host, and the boolean form and the site list each carried
 * a copy that knew only github.io — the form listed "motdang.net" twice
 * (2026-09-25). One function, every caller. */
function siteLabel(row) {
  return row.host.split(".")[0].startsWith(row.site) ? row.host : `${row.host}/${row.site}`;
}

/* One sprite from /icons.svg (same origin), coloured by currentColor. Shipped
 * UI carries no emoji — ICON-POLICY.md. The Worker page is not a docs page, so
 * it brings its own .ic rule (in CSS) rather than the site stylesheet's. */
function sicon(id, cls) {
  return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="/icons.svg#${id}"></use></svg>`;
}

/* The narrowing filters in force, each rendered as a link that takes ITSELF
 * off. Sort and the pin narrow nothing, so they are never here. Shared by the
 * empty page (a filter, not the words, emptied it) and the few-results line
 * (the same way out before the page is quite empty). */
function activeNarrowers(url, st) {
  const off = [];
  if (st.site) off.push(`<a href="${withParams(url, { site: "" })}">ทุกไซต์ · all sites</a>`);
  if (st.since || st.from || st.to) off.push(`<a href="${withParams(url, { since: "", from: "", to: "" })}">ทุกช่วง · any date</a>`);
  if (st.in !== "all") off.push(`<a href="${withParams(url, { in: "" })}">ทั้งหน้า · anywhere on the page</a>`);
  if (st.kind) off.push(`<a href="${withParams(url, { kind: "" })}">ทุกประเภท · every type</a>`);
  if (st.sec) off.push(`<a href="${withParams(url, { sec: "" })}">ทุกหมวด · every section</a>`);
  for (const h of st.has) {
    const rest = st.has.filter((x) => x !== h).join(",");
    off.push(`<a href="${withParams(url, { has: rest })}">${sicon(HAS_LABEL[h][0])} ${HAS_LABEL[h][1]} · ${HAS_LABEL[h][2]} ${sicon("i-x")}</a>`);
  }
  return off;
}

/* One tap that takes every narrower off at once. Offered only beside two or
 * more, since beside one it would just repeat that one's own link. */
function clearAll(url) {
  return `<a href="${withParams(url, { site: "", since: "", from: "", to: "", in: "", kind: "", sec: "", has: "" })}">ล้างตัวกรองทั้งหมด · clear all filters</a>`;
}

function filterBar(url, st, facets, secEn) {
  const groups = [];
  const pick = (label, items) => {
    const shown = items.filter(Boolean);
    if (shown.length < 2) return;
    groups.push(`<div class="g"><b class="k">${label}</b>${shown.join("")}</div>`);
  };
  /* A count belongs to the option, not to the link, so it reads the same
   * whether the option is the one in force or one to click. */
  const link = (on, text, changes, n) => {
    const tail = n === undefined ? "" : ` <span class="n">(${num(n)})</span>`;
    return on ? `<b class="v">${text}${tail}</b>`
              : `<span><a href="${withParams(url, changes)}">${text}</a>${tail}</span> `;
  };
  const hasEvents = facets.has && (facets.has.events > 0);

  /* Sort reorders — it is not a narrower — so it stays ABOVE the fold, always
   * in view, never folded away into Refine. */
  const sorts = Object.entries(SORTS).map(([k, v]) =>
    (v.needsPin && !st.pin) || (v.needsEvents && !hasEvents && st.sort !== k) ? "" :
    link(st.sort === k, v.en ? `${v.th} · ${v.en}` : v.th, { sort: k === "rank" ? (st.intentNear ? "rank" : "") : k })).filter(Boolean);
  const sortRow = sorts.length > 1
    ? `<div class="g srt"><b class="k">${sicon("i-sort")} เรียง · Sort</b>${sorts.join("")}</div>` : "";

  /* Type: a place page, a list of places, or anything else. Offered when the
   * answer holds more than one of them. */
  if (facets.kinds) {
    const present = Object.keys(KINDS).filter((k) => facets.kinds[k] > 0 || st.kind === k);
    if (present.length > 1 || st.kind) {
      const all = Object.values(facets.kinds).reduce((a, n) => a + n, 0);
      pick("ประเภท · Type", [link(!st.kind, "ทั้งหมด · All", { kind: "" }, all)].concat(
        present.map((k) => link(st.kind === k, `${KINDS[k][0]} · ${KINDS[k][1]}`, { kind: k }, facets.kinds[k] || 0))));
    }
  }

  /* Has: each one a switch that adds to the others. The number beside one
   * that is off is what switching it on gives; one every row already has
   * narrows nothing and is not offered. */
  if (facets.has) {
    const on = new Set(st.has || []);
    const items = HAS_KEYS.map((h) => {
      const n = facets.has[h] || 0;
      if (!on.has(h) && (!n || n >= facets.total)) return "";
      const next = on.has(h) ? (st.has || []).filter((x) => x !== h) : HAS_KEYS.filter((x) => on.has(x) || x === h);
      const [icon, th, en] = HAS_LABEL[h];
      const mark = on.has(h) ? `${sicon("i-check", "chk")} ` : "";
      const text = `${mark}${sicon(icon, h === "open" ? "open" : "")} ${th} · ${en}`;
      const tail = ` <span class="n">(${num(n)})</span>`;
      return `<span${on.has(h) ? ' class="on"' : ""}><a href="${withParams(url, { has: next.join(",") })}">${text}</a>${tail}</span> `;
    }).filter(Boolean);
    if (items.length) groups.push(`<div class="g"><b class="k">มี · Has</b>${items.join("")}</div>`);
  }

  /* Section: the first two steps of each page's own breadcrumb. */
  if (facets.secs && (facets.secs.length > 1 || st.sec)) {
    const items = [link(!st.sec, "ทุกหมวด · All sections", { sec: "" })];
    for (const [sec, n] of facets.secs) {
      const en = (secEn || {})[sec];
      items.push(link(st.sec === sec, esc(en ? `${sec} · ${en}` : sec), { sec }, n));
    }
    if (st.sec && !facets.secs.some(([sec]) => sec === st.sec)) {
      items.push(link(true, esc(st.sec), { sec: st.sec }));
    }
    pick("หมวด · Section", items);
  }

  /* One site holding the whole answer is not a choice, the same way a date
   * bucket holding it is not. */
  if (facets.sites && facets.sites.length > (st.site ? 0 : 1)) {
    const items = [link(!st.site, "ทุกไซต์ · All sites", { site: "" }, facets.total0)];
    for (const r of facets.sites.slice(0, 12)) {
      items.push(link(st.site === r.site || st.site === r.host,
                      esc(siteLabel(r)), { site: r.site }, Number(r.n)));
    }
    pick("ไซต์ · Site", items);
  }

  if (facets.dates && facets.dates.all) {
    const d = facets.dates;
    const items = [link(!st.since && !st.from && !st.to, "ทุกช่วง · Any time", { since: "", from: "", to: "" })];
    /* A bucket holding the whole answer narrows nothing — most of Mot Dang
     * carries the date of the nightly build — so it is not offered. */
    let last = d.all;
    for (const [k, v] of Object.entries(SINCE)) {
      if (d[k] && (d[k] < d.all || st.since === k) && d[k] !== last) {
        items.push(link(st.since === k, `${v[0]} · ${v[1]}`, { since: k, from: "", to: "" }, d[k]));
      }
      if (d[k]) last = d[k];
    }
    pick("ปรับปรุง · Updated", items);
  }

  if (!st.fields) {
    pick("คำอยู่ที่ · Words in", Object.keys(IN_COLS).map((k) =>
      link(st.in === k, `${IN_LABEL[k][0]} · ${IN_LABEL[k][1]}`, { in: k === "all" ? "" : k })));
  }
  const rf = groups.join("");
  if (!sortRow && !rf) return "";
  /* The narrowers fold behind one tappable Refine control, so on a phone the
   * results are never pushed below a wall of options; the number on the button
   * is how many filters are in force. */
  const nOn = activeNarrowers(url, st).length;
  const refine = rf
    ? `<details class="refine"><summary>${sicon("i-filter")} ปรับผล · Refine${nOn ? ` <span class="onn">${nOn}</span>` : ""}</summary><div class="rf">${rf}</div></details>`
    : "";
  return `<div class="bar">${sortRow}${refine}</div>`;
}

function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return ["", ""];
  const d = Number(m[3]), mo = Number(m[2]) - 1;
  return [`${d} ${TH_MONTHS[mo]}`, `${d} ${MONTHS[mo]}`];
}

/* What the listing holds besides its words — one line, each part a fact the
 * row itself carries. `aux` holds the week schedules; `when` is Bangkok now. */
export function richLine(row, aux, when, opts) {
  const rich = parseJson(row.rich) || {};
  const parts = [];
  const ways = (rich.ways || []).filter((w) => WAY_LABEL[w]);
  if (ways.length) {
    const icons = ways.map((w) => WAY_LABEL[w][0]).join(" ");
    const names = ways.map((w) => `${WAY_LABEL[w][1]}`).join(" · ");
    parts.push(ways.length > 1
      ? `<span title="${esc(names)}">${icons} ติดต่อได้ ${ways.length} ทาง · ${ways.length} ways to reach</span>`
      : `<span>${icons} ${esc(WAY_LABEL[ways[0]][1])} · ${esc(WAY_LABEL[ways[0]][2])}</span>`);
  }
  /* The toilet line reads what the toilet minisite knows (fleetsearch/crawl.py
   * Toilets): r a report or a recorded fact, s Nan's word, h the habit of
   * this kind of place, n the nearest one in metres. Each goes to the page. */
  const tl = Array.isArray(rich.toilet) ? rich.toilet : null;
  if (tl && tl[0] === "n") {
    parts.push(`<span><a href="/toilets.html" title="${esc(tl[1] || "")}">🚻 ห้องน้ำ ${num(tl[2])} ม. · toilet ${num(tl[2])} m</a></span>`);
  } else if (tl && tl[1]) {
    parts.push(`<span><a href="/toilets.html">🚻 ${esc(tl[1])} · ${esc(tl[2])}</a></span>`);
  }
  const evs = (rich.ev || []).map((e) => ({ e, d: nextDate(e, when.today) })).filter((x) => x.d)
                              .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (evs.length) {
    const [th, en] = shortDate(evs[0].d);
    parts.push(evs.length === 1
      ? `<span>🎪 ${esc(evs[0].e.t || "งาน · event")} · ${th} · ${en}</span>`
      : `<span>🎪 ${evs.length} งาน · ${evs.length} events · ถัดไป ${th} · next ${en}</span>`);
  }
  const iv = row.sk != null && aux ? aux.scheds.get(Number(row.sk)) : null;
  const lamp = !opts || opts.lamp !== false;     // false: the say line already carries the lamp
  if (lamp && iv && openAt(iv, when.minute)) parts.push(`<span>🟢 เปิดอยู่ · open now</span>`);
  else if (lamp && Number(row.has || 0) & HAS.hours) parts.push(`<span>🕘 มีเวลาเปิด · hours listed</span>`);
  const fac = (rich.fac || []).filter((f) => !TOILET_FACETS.has(f[0]) && f[1]);
  if (fac.length) {
    const shown = fac.slice(0, 6);
    parts.push(`<span class="fa" title="${esc(shown.map((f) => `${f[2]} · ${f[3]}`).join(" / "))}">` +
               `${shown.map((f) => esc(f[1])).join("")}${fac.length > 6 ? ` +${fac.length - 6}` : ""}</span>`);
  }
  return parts.length ? `<div class="rich">${parts.join("")}</div>` : "";
}

/* The site's name, then the page's own breadcrumb without its front page. */
function crumbLine(row, rows) {
  const crumbs = parseJson(row.crumbs) || [];
  const home = `https://${row.host}/`;
  const bits = [`<a href="${esc(home)}">${esc(siteLabel(row))}</a>`];
  for (const [name, href, en] of crumbs) {
    const text = esc(en && en !== name ? `${name} · ${en}` : name);
    bits.push(href ? `<a href="${esc(href)}">${text}</a>` : text);
  }
  return `<div class="cr">${bits.join(" › ")}</div>`;
}

/* The picture: the page's own, else a piece of map with its pin. */
export function thumbHtml(row) {
  const t = row.thumb || "";
  const href = esc(row.url);
  if (t.startsWith("p/")) {
    const credit = (parseJson(row.rich) || {}).credit;
    return `<a class="th" href="${href}" tabindex="-1" aria-hidden="true"><img src="${THUMBS}${esc(t)}.webp"` +
           ` alt="" width="72" height="72" loading="lazy" decoding="async"${credit ? ` title="${esc(credit)}"` : ""}></a>`;
  }
  if (!t && row.thumbUrl) {          // a live page of the page maker: its own small cover
    return `<a class="th" href="${href}" tabindex="-1" aria-hidden="true"><img src="${esc(row.thumbUrl)}"` +
           ` alt="" width="72" height="72" loading="lazy" decoding="async"></a>`;
  }
  const m = /^g\/(\d+)_(\d+)$/.exec(t);
  if (m && row.lat != null && row.lon != null) {
    const [x, y] = cellPos(Number(row.lat), Number(row.lon), Number(m[1]), Number(m[2]));
    return `<a class="th" href="${href}" tabindex="-1" aria-hidden="true"><img src="${THUMBS}${esc(t)}.webp"` +
           ` alt="" width="72" height="72" loading="lazy" decoding="async">` +
           `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"></i></a>`;
  }
  return "";
}

/* Share, LINE and Grab on the row itself (share_layer.py, Nan 2026-10-01).
 * Kept short, because every row carries them: LINE sends the link alone (its
 * card brings the title), Grab's full booking link is built by /locshare.js
 * at the tap from data-ll, and Share is wired there too. Without the script,
 * Grab opens its own transport page. Grab only where the row has a pin. */
const ICON = (id) => `<svg class="lsi" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><use href="/icons.svg#${id}"></use></svg>`;
export function rowActs(r) {
  return `<span class="ls-acts"><button type="button" class="ls-a" data-ls-share="${esc(r.url)}" data-ls-t="${esc(r.title)}">` +
         `${ICON("i-share")}แชร์ · Share</button>` +
         `<a class="ls-a ls-line" href="https://line.me/R/share?text=${esc(encodeURIComponent(r.url))}" target="_blank" rel="noopener">${ICON("i-chat")}LINE</a>` +
         (r.lat != null && r.lon != null
           ? `<a class="ls-a ls-grab" href="https://www.grab.com/th/transport/" data-ll="${Number(r.lat).toFixed(6)},${Number(r.lon).toFixed(6)}" ` +
             `data-n="${esc(r.title)}" rel="nofollow noopener">${ICON("i-ride")}Grab</a>` : "") +
         `</span>`;
}

/* A page made with the page maker, marked as what it is. */
export function ownMark(r) {
  return r.site === OWN_SITE ? ` <span class="own">${sicon("i-shop")}เพจของร้านเอง · own page</span>` : "";
}

function resultList(rows, page, n, pin, aux, when) {
  const start = (page - 1) * n + 1;
  const items = rows.map((r) => {
    let far = "";
    if (pin && r.lat != null && r.lon != null) {
      const to = { lat: Number(r.lat), lon: Number(r.lon) };
      const [th, en] = farLabel(metres(pin, to), pin.exact);
      const dir = bearing(pin, to);
      far = ` <span class="d">· ${esc(th)} · ${esc(en)}${dir ? ` ${esc(dir[1])}` : ""}</span>`;
    }
    /* findpreview.js: the reading, the lamp with its hours, where it stands,
     * a list's pictures, and what the peek card reads off the row. */
    const iv = r.sk != null && aux ? aux.scheds.get(Number(r.sk)) : null;
    const pic = thumbHtml(r) || ((parseJson(r.rich) || {}).sc
      ? `<a class="th" href="${esc(r.url)}" tabindex="-1" aria-hidden="true"></a>` : "");
    return `<li><div class="r" ${rowData(r)}>${pic}<div class="b">${PEEK_BTN}${crumbLine(r, rows)}` +
           `<a class="t" href="${esc(r.url)}">${esc(r.title)}</a>${ownMark(r)}${judgeMarks(r.url)}${(readingHtml(r) + sayLine(r, iv, when.minute)) || "<br>"}` +
           `${esc(r.abstract)}${stripHtml(r)}` +
           `${richLine(r, aux, when, { lamp: !iv }) || "<br>"}` +
           `<span class="u">${esc(r.url.replace(/^https?:\/\//, ""))}</span>` +
           `<span class="m"> · ${dmy(r.lastmod)} · ${r.kb}K</span>${far}${rowActs(r)}</div></div></li>`;
  }).join("\n");
  return `<ol start="${start}">${items}</ol><style>${PREVIEW_CSS}</style>`;
}

/* The one script on the page, and it runs only when a distance is on offer:
 * the exact position is the reader's to give, the browser will not hand it
 * over without a tap, and the tap has to happen inside a click handler. It
 * reloads the same address with near=, so the answer stays a plain page and a
 * reader who never taps loses nothing but precision. */
function exactLink(url, pin) {
  const back = new URL(url.toString());
  back.searchParams.delete("near");
  const where = pin
    ? `${esc(pin.exact ? "ตำแหน่งจริงของคุณ · your exact position"
                       : `ตำแหน่งโดยประมาณจากเครือข่าย${pin.city ? ` (${pin.city})` : ""} · your network's rough position`)}`
    : "";
  const button = `<button type="button" id="md-exact">📍 ${pin && pin.exact
    ? "วัดใหม่ · measure again" : "ใช้ตำแหน่งจริง · use my exact position"}</button>`;
  return `<p class="note">${where} ${button}</p>
<script>document.getElementById("md-exact").addEventListener("click",function(){
var b=this;b.disabled=true;b.textContent="…";
navigator.geolocation.getCurrentPosition(function(p){
var u=new URL(${JSON.stringify(back.pathname + back.search)},location.origin);
u.searchParams.set("near",p.coords.latitude.toFixed(5)+","+p.coords.longitude.toFixed(5));
location.href=u.pathname+u.search;},function(){b.disabled=false;
b.textContent="\u0e40\u0e1a\u0e23\u0e32\u0e27\u0e4c\u0e40\u0e0b\u0e2d\u0e23\u0e4c\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e43\u0e2b\u0e49 \u00b7 the browser did not give it";},
{maximumAge:60000,timeout:8000});});</script>`;
}

function pager(url, page, total, n) {
  const last = Math.min(MAX_PAGE, Math.ceil(total / n));
  if (last <= 1) return "";
  const link = (p, text) => `<a href="${withParams(url, { p })}">${text}</a>`;
  let lo = Math.max(1, page - 4), hi = Math.min(last, lo + 9);
  lo = Math.max(1, hi - 9);
  const parts = [];
  if (page > 1) parts.push(link(page - 1, "« ก่อน · Prev"));
  for (let p = lo; p <= hi; p++) parts.push(p === page ? `<b>${p}</b>` : link(p, String(p)));
  if (page < last) parts.push(link(page + 1, "ถัดไป · Next »"));
  return `<p class="pages">หน้า · Pages: ${parts.join(" ")}</p>`;
}

/* GOOD / NOT IT (Nan, 2026-10-20: "Would like to provide feedback directly
 * after a bad search."). One line under the count: 👍 sends at once; 👎 opens
 * what went wrong, ✓ ✕ on each row, and a box for what the reader was after.
 * Both are plain forms to /api/find/judge (findJudge in findlearn.js), so a
 * browser with no script still sends; with script the line answers in place.
 * snap is the page as built, the same for every reader of a cached page. */
export const JUDGE_WHY = [
  ["missing", "ไม่มีที่หา · not here"],
  ["kind", "ผิดประเภท · wrong kind"],
  ["far", "ไกลไป · too far"],
  ["closed", "ปิดแล้ว ข้อมูลเก่า · closed or old"],
  ["buried", "ที่ใช่อยู่ลึก · right one buried"],
  ["words", "อ่านคำผิด · misread my words"],
];

export function judgePanel(q, qm, snap, hasRows) {
  const hid = `<input type="hidden" name="q" value="${esc(q)}"><input type="hidden" name="qm" value="${esc(qm)}">` +
              `<input type="hidden" name="snap" value="${esc(JSON.stringify(snap))}">`;
  const why = JUDGE_WHY.map(([k, t]) => `<label><input type="checkbox" name="why" value="${k}">${esc(t)}</label>`).join("");
  return `<div class="jl" id="jl"><form class="jg" method="post" action="/api/find/judge">${hid}<input type="hidden" name="v" value="good">` +
    `<button type="submit"><span aria-hidden="true">👍</span> ใช่ · good</button></form>` +
    `<details class="jf" id="jfd"><summary><span aria-hidden="true">👎</span> ไม่ใช่ · not it</summary>` +
    `<form id="jf" method="post" action="/api/find/judge">${hid}<input type="hidden" name="v" value="bad">` +
    `<div class="jw">${why}</div>` +
    (hasRows ? `<p class="jh">แตะ ✓ ✕ ที่ผลด้านล่าง · tap ✓ right or ✕ wrong on the rows below</p>` : "") +
    `<input name="want" maxlength="600" autocomplete="off" placeholder="หาอะไรอยู่ ชื่อ ลิงก์แผนที่ · what were you after? a name, a map link">` +
    `<button type="submit">ส่ง · send</button></form></details></div>
<script>(function(){
var box=document.getElementById("jl");if(!box||!window.fetch)return;
box.addEventListener("submit",function(e){var f=e.target;e.preventDefault();
var o={},fd=new FormData(f),c=document.documentElement.classList,lang=c.contains("lang-en")?"en":c.contains("lang-th")?"th":"";
fd.forEach(function(v,k){if(k==="why"||k==="y"||k==="n")(o[k]=o[k]||[]).push(v);else o[k]=v;});
o.lang=lang;
[].forEach.call(box.querySelectorAll("button"),function(b){b.disabled=true;});
fetch(f.action,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(o)}).then(function(r){
var p=document.createElement("p");p.className="jok";var en=document.documentElement.classList.contains("lang-en"),th=document.documentElement.classList.contains("lang-th");
p.textContent=r.ok?(en?"Got it":th?"ได้รับแล้ว":"ได้รับแล้ว · got it"):(en?"Did not send":th?"ส่งไม่ได้":"ส่งไม่ได้ · did not send");
box.replaceWith(p);document.querySelectorAll(".jm").forEach(function(m){m.remove();});
}).catch(function(){[].forEach.call(box.querySelectorAll("button"),function(b){b.disabled=false;});});
});})();</script>`;
}

/* The ✓ ✕ on one row, owned by the not-it form by its id. */
function judgeMarks(u) {
  return `<span class="jm"><label class="jy" title="ใช่อันนี้ · this one"><input type="checkbox" form="jf" name="y" value="${esc(u)}">✓</label>` +
         `<label class="jn" title="ผิด · wrong"><input type="checkbox" form="jf" name="n" value="${esc(u)}">✕</label></span>`;
}

/* PLACE REFINE, as progressive enhancement. The fleet search answers pages;
 * the place engine (/api/v1/search) answers PLACES and now hands back the
 * splits that would divide THIS result — its cuisines, shelves, services,
 * districts. A reader who typed two ordinary words gets, without knowing any
 * shelf code, a row of chips that re-ask with one more word. It is a fetch,
 * not a server join: the page still renders and caches as a plain document,
 * and a browser that runs no script, or an API that is down, loses only the
 * chips. DOM-built with textContent, so a value can carry no markup. */
function rfPanel(q) {
  return `<div id="mdrf" hidden></div>
<script>(function(){
var q=${JSON.stringify(q).replace(/</g, "\\u003c")};
fetch("/api/v1/search?q="+encodeURIComponent(q)+"&limit=1").then(function(r){return r.ok?r.json():null;}).then(function(d){
if(!d||!d.refine||!d.refine.length)return;
var box=document.getElementById("mdrf");if(!box)return;
function chipLink(add){var t=(q+" "+add).replace(/\\s+/g," ").trim();var u=new URL(location.href);u.searchParams.set("q",t);u.searchParams.delete("p");return u.pathname+u.search;}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
/* Folded, not spread. The reader did not ask to narrow — offer the door, do
 * not fill the screen with it. One tap opens the groups; the summary says how
 * many ways there are so the offer is legible while closed. Persist the reader
 * choice for the session, so somebody who wants it open keeps it open. */
var n=0; d.refine.forEach(function(g){ n += (g.values||[]).length; });
var det=el("details","refine mdrf-d");
try{ det.open = sessionStorage.getItem("mdrf-open")==="1"; }catch(e){}
det.addEventListener("toggle",function(){ try{ sessionStorage.setItem("mdrf-open", det.open?"1":"0"); }catch(e){} });
var sum=document.createElement("summary");
sum.appendChild(document.createTextNode("ปรับผล · refine "));
sum.appendChild(el("span","onn",String(n)));
det.appendChild(sum);
var bar=el("div","bar rf");
d.refine.forEach(function(g){
var row=el("div","g");row.appendChild(el("b","k",(g.th||"")+" · "+(g.en||"")));
(g.values||[]).forEach(function(v){
var sp=el("span");var a=document.createElement("a");a.href=chipLink(v.add||v.value);
a.appendChild(document.createTextNode((v.en||v.value)+" "));a.appendChild(el("span","n",String(v.count)));
sp.appendChild(a);row.appendChild(sp);});
bar.appendChild(row);});
det.appendChild(bar);
box.appendChild(det);box.hidden=false;
}).catch(function(){});
})();</script>`;
}

/* ------------------------------------------------------------ the handler */

function html(body, status, extra) {
  const h = { "content-type": "text/html; charset=utf-8", ...(extra || {}) };
  return new Response(body, { status: status || 200, headers: h });
}

/* A query the engine refused and a database that is not answering are not the
 * same news, and the page must not blame the reader for the second. FTS5 names
 * itself when it rejects an expression; anything else — an import holding the
 * database, a connection lost — is ours, and the page says so and says what to
 * do about it. A full reload takes the index away for minutes at a time
 * (fleetsearch/README.md), which is exactly when a reader meets this. */
export function faultKind(fault) {
  return /fts5|no such column|malformed MATCH|syntax error/i.test(fault) ? "query" : "engine";
}

function faultHtml(fault) {
  const detail = esc(fault.replace(/^D1_ERROR:\s*/, "").slice(0, 300));
  if (faultKind(fault) === "query") {
    return `<p class="count">อ่านนิพจน์ไม่ออก · the expression could not be read.</p>` +
           `<p class="note">${detail}</p>`;
  }
  return `<p class="count">ดัชนีกำลังปรับปรุง · the index is being rebuilt.</p>` +
         `<p class="note">ลองอีกครั้งในอีกสักครู่ · try again shortly. ` +
         `ส่วนอื่นของเว็บใช้ได้ตามปกติ · the rest of the site is unaffected.</p>` +
         `<p class="note">${detail}</p>`;
}

/* env.SEARCH is the D1 binding (publish/wrangler.toml). `coreP()` returns a
 * promise of the fleet SearchCore (segmenter + thesaurus) and is called only
 * when a query needs it, so an English query never waits on the dictionary. */
/* Whatever goes wrong inside, the reader gets a page that says so — never a
 * bare error status with nothing in it. */
export async function fleetSearch(request, env, url, ctx, coreP, now) {
  try {
    return await answer(request, env, url, ctx, coreP, now);
  } catch (e) {
    const fault = String(e && e.message || e);
    return html(shell("ค้นหา · Search · มดแดง", head(false) + simpleForm(clean(url.searchParams.get("q") || "").slice(0, MAX_Q), { has: [], in: "all", n: 10 }) +
      faultHtml(fault.startsWith("D1_") ? fault : "engine: " + fault), "noindex,follow"), 503,
      { "cache-control": "no-store", "retry-after": "60" });
  }
}

async function answer(request, env, url, ctx, coreP, now) {
  const t0 = Date.now();
  const today = now || new Date();
  const sp = url.searchParams;
  const adv = sp.get("adv") === "1";
  const q = clean(sp.get("q") || "").slice(0, MAX_Q);
  const fmt = sp.get("fmt");
  const lucky = sp.get("lucky") === "1";

  /* The state a link or a form has to carry. Everything is read back out of
   * the address, so a results page is a bookmark and a shared link is the
   * same answer for the next reader. */
  const since = SINCE[sp.get("since")] ? sp.get("since") : "";
  /* A date that is not a date would compare as a string and quietly empty the
   * page, so it is dropped rather than obeyed. */
  const day = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) || "") ? sp.get(k) : "");
  const st = {
    site: (sp.get("site") || "").trim().toLowerCase().slice(0, 60),
    sort: SORTS[sp.get("sort")] ? sp.get("sort") : "rank",
    in: IN_COLS[sp.get("in")] !== undefined ? sp.get("in") || "all" : "all",
    since,
    from: since ? new Date(today.getTime() - SINCE[since][2] * 86400000).toISOString().slice(0, 10)
                : day("from"),
    to: day("to"),
    /* 200 for a JSON answer only: the city map draws a search's places as dots
     * (mapfirst_layer.py), up to 200 in view. */
    n: PER_PAGE.includes(Number(sp.get("n"))) || (sp.get("fmt") === "json" && Number(sp.get("n")) === 200)
      ? Number(sp.get("n")) : 10,
    bbox: bboxOf(sp.get("bbox")),
    pin: readerPin(sp, request),
    kind: KINDS[sp.get("kind")] ? sp.get("kind") : "",
    sec: clean(sp.get("sec") || "").slice(0, 160),
    /* Canonical order, so ?has=toilet,photo and ?has=photo,toilet are one
     * address and one cached answer. */
    has: HAS_KEYS.filter((h) => (sp.get("has") || "").split(",").includes(h)),
  };
  st.sortAsked = SORTS[sp.get("sort")] ? sp.get("sort") : "";
  st.hasAsked = st.has.slice();
  const when = bangkok(today);
  if (st.sort === "near" && !st.pin) st.sort = "rank";
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(sp.get("p") || "1", 10) || 1));

  if (!env.SEARCH) {
    return html(shell("ค้นหา · Search", head(adv) +
      `<p class="count">ยังไม่พร้อม · the index is not deployed yet.</p>`, "noindex"), 503);
  }
  const db = env.SEARCH;

  /* The front: the box and every site, counted. A query of nothing but signs
   * ("  -  *  title:) gets the same page with a line saying why. */
  const front = async (said) => {
    let c = null;
    try { c = await counts(db); } catch { /* the front still opens */ }
    const body = head(adv) + (adv ? booleanForm(q, st, c) : simpleForm(q, st)) +
                 (said || "") + sitesList(c);
    return html(shell(adv ? "ตรรกะ · Boolean search · มดแดง" : "ค้นหา · Search · มดแดง", body, q ? "noindex,follow" : "index,follow",
                      !q && !adv ? FRONT_CARD : ""),
                200, { "cache-control": `public, max-age=60, s-maxage=${CACHE_S}` });
  };
  if (!q) return front("");

  /* One rendered answer per distinct address, shared by everyone who asks it. */
  let cache = null, ckey = null;
  try {
    cache = caches.default;
    /* A page built from the network's guess (no near= in the address) is
     * kept per ~10 km of that guess: by address alone, the next reader at
     * this data centre got the last reader's distances, order and city
     * (Nan, 2026-10-20, gemba 2). */
    const ku = new URL(url.toString());
    if (st.pin && !st.pin.exact) ku.searchParams.set("__g", `${st.pin.lat.toFixed(1)},${st.pin.lon.toFixed(1)}`);
    ckey = new Request(ku.toString(), { method: "GET" });
    const hit = await cache.match(ckey);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("x-fleet-cache", "hit");
      return r;
    }
  } catch { cache = null; }

  /* Each step's time goes out as a Server-Timing header, so a slow answer
   * says where it was slow. */
  const T = {};
  const lap = async (k, p) => {
    const s = Date.now();
    try { return await p; } finally { T[k] = (T[k] || 0) + Date.now() - s; }
  };
  /* Intent first: the constraint words leave the match (liftIntent). */
  let intent = liftIntent(adv ? "" : q);
  let qm = adv ? q : intent.q;
  let boolQ = adv || isBoolean(qm);
  /* The dictionary and thesaurus cost one R2 read per isolate. Every simple
   * query reads the thesaurus now, since other spellings join the first step;
   * the boolean door needs only the segmenter, and only for Thai. The
   * register, the calendar, the dictionary and the lamp schedules do not
   * depend on one another, so they are fetched at once. */
  let core = null;
  const getCore = async () => {
    if (core === null && coreP) { try { core = await coreP(); } catch { core = false; } }
    return core || null;
  };
  /* a sum, a currency or a unit answers in its own box (quickanswer.js) */
  const qaM = adv ? null : quickMatch(q);
  let [register, events, , ax, learn, answers, mean, qaD] = await Promise.all([
    lap("sites", siteRows(env)),
    adv ? null : lap("cal", eventData(env)),
    (!boolQ || /[฀-๿]/.test(qm)) ? lap("dict", getCore()) : null,
    lap("aux", aux(db)),
    adv ? new Map() : lap("learn", learnedFor(db, qm)),
    adv ? null : lap("answers", answerDocs(env)),
    adv || boolQ || !qm ? null : lap("meaning", meaningSoon(env, qm, ctx).catch(() => null)),
    qaM && (qaM.kind === "fx" || qaM.kind === "tr") ? lap("quick", quickData(qaM, env, ctx).catch(() => null)) : null,
  ]);
  const qaB = quickHtml(qaM, qaD);
  const meaning = mean ? mean.hits : null;
  if (intent.near && st.pin && !sp.get("sort")) st.sort = "near";
  if (intent.open && !st.has.includes("open")) st.has = HAS_KEYS.filter((h) => h === "open" || st.has.includes(h));
  st.intentNear = intent.near;
  const siteHits = qm ? siteMatch(qm, register) : [];
  const ansHit = qm && answers ? answerMatch(qm, answers) : null;
  /* the calendar answers its own words (calfind.js); the boolean door is left alone */
  const calM = adv ? null : calMatch(q, events, today.getTime());
  const seg = core ? core.seg : null;
  const thes = core ? core.thes : null;
  /* Register names the dictionary would take apart (รังมด → รัง มด). */
  const keep = new Set();
  if (seg) {
    for (const r of register) {
      const th = norm(r.th || "").replace(/\s+/g, "");
      if (/^[฀-๿]{3,}$/.test(th) && seg.split(th).length > 1) keep.add(th);
    }
  }
  /* A word read as an intent inside a name stays in the name (gemba 2,
   * 2026-10-20: เจ, "vegetarian", was lifted out of the shop ปฐมเจ, the match
   * became ปฐม, and the shop was not found). A run of the words that holds a
   * lifted word and is itself in some page's title keeps the query whole. */
  if (!adv && intent.said.length) {
    const lc = (x) => String(x).toLowerCase();
    const runs = q.split(/\s+/).filter((t) => intent.said.some((w) => lc(t) !== lc(w) && lc(t).includes(lc(w))));
    const m = runs.map((t) => phrase(t, seg)).filter(Boolean).map((p) => `title_s : ${p}`).join(" OR ");
    if (m) {
      try {
        const hit = await lap("name", db.prepare("SELECT rowid FROM fts WHERE fts MATCH ? LIMIT 1").bind(m).first());
        if (hit) {
          /* the name runs stand in as placeholders while the rest is read
           * again, so "ปฐมเจ ใกล้ฉัน" keeps its near-me */
          let masked = ` ${q} `;
          runs.forEach((t, i) => { masked = masked.split(t).join(` zqxname${i} `); });
          intent = liftIntent(masked.trim());
          let back = intent.q;
          runs.forEach((t, i) => { back = back.split(`zqxname${i}`).join(t); });
          intent.q = back.replace(/\s+/g, " ").trim();
          qm = intent.q; boolQ = isBoolean(qm);
        }
      } catch { /* lifted as before */ }
    }
  }
  const common = boolQ ? new Set() : await lap("common", commonWords(db, qm, seg));
  const pl = boolQ ? planBoolean(qm, seg) : planSimple(qm, seg, thes, { keep, common });
  st.fields = !!pl.fields;
  const sites = Array.from(new Set(pl.sites.concat(st.site ? [st.site] : []))).slice(0, 8);
  /* "museum chiang rai": the city stays in the match, but the thing is the
   * name ("museum"), and the city's centre stands in for the reader when the
   * reader is not already there. Distances on the page stay the reader's. */
  const cq = boolQ ? null : cityOf(qm);
  /* the words a shelf is looked up by: "motorbike rental", not "… chiang rai" */
  const doorWords = cq ? cq.rest : qm;
  let rankPin = st.pin;
  if (cq) {
    const pc = planSimple(cq.rest, seg, thes, { keep, common });
    /* the words as said stay a name too: คูเมืองเชียงราย is the moat itself */
    pl.names = Array.from(new Set((pl.names || []).concat(pc.names || []))).slice(0, 6);
    if (st.pin && metres(st.pin, CITY[cq.city]) < 30000) rankPin = { ...st.pin, city: cq.city, stated: true };
    else rankPin = { lat: CITY[cq.city].lat, lon: CITY[cq.city].lon, exact: false, city: cq.city, stated: true };
  }
  const cover = boolQ || pl.fields ? [] : Array.from(new Set((pl.items || []).map((it) => String(it.text).toLowerCase())
    .filter((w) => w.length >= 2 && !STOP_EN.has(w))));
  const opts = { sites, qsites: pl.sites, name: pl.name || "", names: pl.names || [], cover, in: st.in, fields: pl.fields,
                 sort: st.sort, pin: rankPin, drop: true,
                 from: st.from, to: st.to, n: st.n, offset: (page - 1) * st.n,
                 kind: st.kind, sec: st.sec, has: st.has, bbox: st.bbox, today: when.today,
                 open: openIds(ax.scheds, when.minute), learn, pins: adv ? new Map() : pinsFor(q),
                 prefer: adv ? [] : preferOf(intent.heard, { phrase, seg, scheds: ax.scheds, openAt }),
                 sem: semBoost(meaning) };
  const wantFacets = !lucky && fmt !== "json";

  /* What the box understood besides the words, said in one line each. */
  const said = [];
  if (intent.near) {
    said.push(st.pin
      ? (st.sort === "near" ? "ใกล้ฉัน — เรียงใกล้ที่สุดก่อน · near me — nearest first" : "")
      : "ใกล้ฉัน — ยังไม่รู้ตำแหน่ง · near me — no position known");
  }
  if (intent.open) said.push("เปิดอยู่ — กรองเฉพาะที่เปิดอยู่ · open now — filtered to open now");
  if (intent.buy) said.push("หาซื้อ · where to buy");
  said.push(...saidOf(intent.heard, st.sort === "rank" || st.sort === "near"));
  if (intent.price) {
    said.push(intent.price === "low" ? "ราคาถูก — ไม่มีราคาให้กรอง · cheap — no prices to filter on"
                                     : "ราคาแพง — ไม่มีราคาให้กรอง · pricey — no prices to filter on");
  }
  const saidHtml = said.filter(Boolean).map((x) => `<p class="note">${esc(x)}</p>`).join("");

  if (pl.empty) {
    let why = "";
    if (pl.negOnly && pl.negOnly.length) {
      why = `<p class="count">ไม่มีคำให้ลบออก · nothing to subtract from: ${esc(pl.negOnly.map((x) => "−" + x.replace(/^"|"$/g, "")).join(" "))}</p>` +
            `<p class="note">เพิ่มคำที่ต้องการ · add a word to keep, e.g. <i>massage −spa</i></p>`;
    } else if (intent.said.length) {
      why = `<p class="count">พิมพ์สิ่งที่หา · type what to look for</p>`;
    } else {
      why = `<p class="count">พิมพ์คำ · type a word.</p>`;
    }
    if (pl.error && !(pl.negOnly && pl.negOnly.length)) why = `<p class="note">${esc(pl.error)}</p>` + why;
    else if (pl.error) why += `<p class="note">${esc(pl.error)}</p>`;
    if (qaB && fmt !== "json") return front(qaB + saidHtml);
    if (fmt === "json") {
      return new Response(JSON.stringify({ q, mode: pl.mode, total: 0, results: [], quick: quickJson(qaM, qaD), error: pl.error || undefined,
        note: pl.negOnly && pl.negOnly.length ? "nothing to subtract from" : "no words" }), { status: 200, headers: {
        "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*",
        "cache-control": `public, max-age=60, s-maxage=${CACHE_S}` } });
    }
    return front(saidHtml + why);
  }

  let rows = [], total = 0, note = "", used = "", fault = "", answered = null, fixUsed = {};
  let facets = { sites: null, dates: null, total0: 0 };
  const tried = [];
  const attempt = async (step) => {
    tried.push(step.match);
    try {
      const r = await lap("query", run(db, step.match, opts, wantFacets, today, st));
      rows = r.rows; total = r.total; used = narrow(step.match, opts);
      if (r.facets) facets = r.facets;
      if (total) { note = step.note; answered = step.match; }
      return total > 0;
    } catch (e) {
      fault = String(e && e.message || e);
      used = narrow(step.match, opts);
      return true;                                   // stop: asking again will not help
    }
  };
  /* Every word first (as typed, with its other spellings, then a compound
   * split); then near spellings when that found nothing or only a page or
   * two; then any of the words. Each step only when the one before fell short. */
  /* The shelf the words name is looked up beside the first query, not after
   * it: it depends on the words, not on the answer (one round trip saved). */
  const doorOk = pl.mode === "simple" && (page === 1 || lucky) && !st.site && !st.kind && !st.sec &&
                 !st.has.length && doorWords.split(" ").length <= 3;
  const doorQuery = (fx) => {
    const forms = [doorWords, qm].concat(pl.names || [], Object.values(fx).flat())
      .filter((v, k, a) => a.indexOf(v) === k).slice(0, 8);
    const ds = doorSql(forms, [doorWords].concat(Object.values(fx).flat()));
    return ds.length
      ? lap("shelf", db.batch(ds.map((d) => db.prepare(d.text).bind(...d.binds)))).then((res) => ({ res, forms }))
      : Promise.resolve({ res: [], forms });
  };
  const doorP = doorOk ? doorQuery({}).catch(() => null) : null;
  /* People's own pages (ownfind.js): the page maker is asked beside the index,
   * waits its few hundred ms at most, and an empty list is the fallback. */
  const ownP = ownWanted({ q: qm, adv, boolQ, lucky, page, sort: st.sort, site: st.site, kind: st.kind,
                           sec: st.sec, has: st.has, from: st.from, to: st.to })
    ? lap("own", ownPagesSoon(env, qm, st.pin)) : null;
  let partials = pl.steps.filter((x) => x.partial);
  for (const step of pl.steps.filter((x) => !x.partial)) if (await attempt(step)) break;
  if (!fault && pl.mode === "simple" && total <= 2 && pl.items) {
    const fix = await lap("spell", nearSpell(db, pl.items, seg));
    if (Object.keys(fix).length) {
      const keepRows = { rows, total, note, used, facets, answered };
      const lp = planSimple(qm, seg, thes, { keep, fix, common });
      let got = false;
      for (const step of lp.steps.filter((x) => !x.partial)) {
        if (tried.includes(step.match)) continue;
        if (await attempt(step)) { got = true; break; }
      }
      if (fault || !got || total <= keepRows.total) {
        ({ rows, total, note, used, facets, answered } = keepRows);
        fault = "";
      } else {
        fixUsed = fix;
      }
      partials = lp.steps.filter((x) => x.partial);
    }
  }
  if (!total && !fault) for (const step of partials) if (await attempt(step)) break;

  /* The shelf the words name goes first on the first page of best match, and
   * is where Lucky lands. */
  let door = null;
  if (!fault && answered && doorOk) {
    try {
      const got = Object.keys(fixUsed).length ? await doorQuery(fixUsed) : await doorP;
      door = got ? doorPick(got.res.flatMap((r) => r.results || []), got.forms, rankPin) : null;
    } catch { door = null; }
    /* A tag page goes first for a kind ("karaoke"), never over a place named
     * by the words: "ประตูท่าแพ" is the gate, not the Tha Phae Gate tag. */
    if (door && /\/tag\//.test(door.url)) {
      const said = norm(doorWords);
      const named = rows.some((r) => r.kind === "place" &&
        String(r.title || "").split(/ · | — /).some((piece) => norm(piece) === said));
      if (named) door = null;
    }
    if (door && st.sort === "rank" && !lucky) {
      rows = [door].concat(rows.filter((r) => r.id !== door.id)).slice(0, st.n);
    }
  }
  if (ownP && !fault) {
    const live = await ownP;
    if (live.length) {
      const m = mergeOwn(rows, live, { HAS, today: when.today }, ax);
      rows = m.rows; ax = m.aux; total += m.added;
    }
  }
  const ms = Date.now() - t0;
  const timing = Object.entries(T).map(([k, v]) => `${k};dur=${v}`).concat(`total;dur=${ms}`).join(", ");

  /* Lucky: the shelf; else a Mot Dang minisite from the register; else a Mot
   * Dang page whose title carries the words; an off-site card only when
   * nothing here answers. */
  if (lucky && !qaB && (rows.length || siteHits.length || door)) {
    const forms = [qm].concat(pl.names || [], Object.values(fixUsed).flat()).map((f) => norm(f)).filter(Boolean);
    const here = (u) => /^https:\/\/motdang\.net\//.test(u || "");
    const titled = rows.find((r) => here(r.url) && forms.some((f) => norm(r.title).includes(f)));
    const to = (door && door.url) || (siteHits.find((r) => here(r.u)) || {}).u || (titled && titled.url) ||
               (siteHits[0] || {}).u || (rows[0] || {}).url;
    return new Response(null, { status: 302, headers: {
      location: to, "cache-control": "no-store", "x-fleet-ms": String(ms), "server-timing": timing } });
  }

  if (fmt === "json") {
    const body = JSON.stringify({
      q, mode: pl.mode, match: used, sites, page, per_page: st.n, total,
      quick: quickJson(qaM, qaD),
      sort: st.sort, in: st.in, from: st.from || undefined, to: st.to || undefined,
      kind: st.kind || undefined, sec: st.sec || undefined, has: st.has.length ? st.has : undefined,
      near: st.pin ? { lat: st.pin.lat, lon: st.pin.lon, exact: st.pin.exact } : undefined,
      note: note || undefined,
      intent: intent.said.length ? { lifted: intent.said, heard: intent.heard.length ? intent.heard.map((h) => h.id) : undefined,
        leads: intent.heard.length ? leadJson(intent.heard, { top: rows.find((r) => /^https:\/\/motdang\.net\/(cm|cr)\/p\//.test(r.url || "")) || null, q: qm, today: when.today, origin: url.origin }) : undefined,
        near: intent.near || undefined, open_now: intent.open || undefined,
        price: intent.price ? { asked: intent.price, filtered: false } : undefined } : undefined,
      spelling: Object.keys(fixUsed).length ? fixUsed : undefined,
      meaning: meaning && meaning.length ? { boosted: opts.sem.size || undefined,
        rescued: page === 1 ? rescueRows(meaning, rows, total).map((h) => ({ url: h.url, title: h.title, score: h.score })) : undefined } : undefined,
      shelf: door ? door.url : undefined,
      answer: ansHit ? { topic: ansHit.a.en, answer: ansHit.a.a_en, answer_th: ansHit.a.a_th, read: ansHit.doc.read,
        pages: (ansHit.a.go || []).map((g) => g.u), desk: ansHit.doc.desk.name, desk_page: ansHit.a.d || undefined,
        line: ansHit.doc.desk.line || undefined, sources: (ansHit.a.src || []).map((x) => x[0]),
        disclose: ansHit.doc.desk.disclose_en } : undefined,
      sites: siteHits.length ? siteHits.map((r) => ({ url: r.u, th: r.th, en: r.en,
                                                     line: [r.lt, r.le].filter(Boolean).join(" · ") })) : undefined,
      calendar: calM ? { when: calM.when || undefined, total: calM.total, more: calM.more || undefined,
        events: calM.events.map((e) => ({ title: e.t, start: e.s, end: e.e || undefined, all_day: e.ad || undefined,
          venue: e.v || undefined, kind: e.c, lat: e.la, lon: e.lo,
          place: e.vu ? `${url.origin}/${e.vu}` : undefined, calendar: `${url.origin}/#ev=${e.k}`,
          source: e.url || undefined })) } : undefined,
      error: pl.error || (fault ? `${faultKind(fault)} fault` : undefined),
      results: rows.map((r) => {
        const rich = parseJson(r.rich) || {};
        const iv = r.sk != null ? ax.scheds.get(Number(r.sk)) : null;
        const ev = (rich.ev || []).map((e) => ({ title: e.t || undefined, next: nextDate(e, when.today),
                                                  weekly: e.w && e.w.length ? e.w : undefined }))
                                  .filter((e) => e.next);
        return {
          url: r.url, title: r.title, abstract: r.abstract, site: r.site,
          lastmod: r.lastmod, kb: r.kb, kind: r.kind || undefined,
          crumbs: (parseJson(r.crumbs) || []).map(([name, href, en]) => ({ name, url: href || undefined, en: en || undefined })),
          thumb: r.thumb ? `${url.origin}${THUMBS}${r.thumb}.webp` : r.thumbUrl || undefined,
          own_page: r.site === OWN_SITE ? true : undefined,
          ways: rich.ways,
          toilet: Array.isArray(rich.toilet) ? (rich.toilet[0] === "n"
            ? { kind: "nearby", name: rich.toilet[1] || undefined, metres: rich.toilet[2] }
            : { kind: { r: "reported", s: "stated", h: "usual" }[rich.toilet[0]], th: rich.toilet[1], en: rich.toilet[2] })
            : undefined,
          events: ev.length ? ev : undefined,
          hours: Number(r.has || 0) & HAS.hours ? true : undefined,
          open_now: iv ? openAt(iv, when.minute) : undefined,
          facets: rich.fac ? rich.fac.map((f) => f[0]) : undefined,
          lat: r.lat == null ? undefined : Number(r.lat),
          lon: r.lon == null ? undefined : Number(r.lon),
          metres: st.pin && r.lat != null
            ? Math.round(metres(st.pin, { lat: Number(r.lat), lon: Number(r.lon) })) : undefined,
        };
      }),
    });
    return new Response(body, { status: 200, headers: {
      "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*",
      "cache-control": `public, max-age=60, s-maxage=${CACHE_S}`, "x-fleet-ms": String(ms), "server-timing": timing } });
  }

  /* The page as built, for the good / not-it line (judgePanel): what a
   * machine needs to replay and score this answer later. */
  const snapOf = () => ({
    q, qm, mode: pl.mode, match: String(used || "").slice(0, 600), note: note || undefined,
    said: intent.said.length ? intent.said : undefined, door: door ? door.url : undefined,
    spelling: Object.keys(fixUsed).length ? fixUsed : undefined,
    sort: st.sort, in: st.in, site: st.site || undefined, kind: st.kind || undefined, sec: st.sec || undefined,
    has: st.has.length ? st.has : undefined, from: st.from || undefined, to: st.to || undefined,
    /* Only a position the address carries (near=): a network guess differs by
     * reader, and this page is cached for every reader of the address. */
    near: st.pin && st.pin.exact ? [Math.round(st.pin.lat * 100) / 100, Math.round(st.pin.lon * 100) / 100] : undefined,
    sites: siteHits.length ? siteHits.slice(0, 3).map((r) => r.u) : undefined,
    answer: ansHit ? ansHit.a.en : undefined,
    page, n: st.n, total,
    rows: rows.map((r, i) => [(page - 1) * st.n + i + 1, r.url]),
    rescued: page === 1 && meaning ? rescueRows(meaning, rows, total).map((h) => h.url) : undefined,
    ms, built: new Date().toISOString(),
  });
  let c = null;
  if (adv) { try { c = await counts(db); } catch { c = null; } }
  let body = head(adv) + (adv ? booleanForm(q, st, c) : simpleForm(q, st));
  if (pl.error) body += `<p class="note">${esc(pl.error)}</p>`;
  body += leadHtml(intent.heard, { top: rows.find((r) => /^https:\/\/motdang\.net\/(cm|cr)\/p\//.test(r.url || "")) || null, q: qm, today: when.today, esc }) + saidHtml;
  if (intent.near && !st.pin) body += exactLink(url, null);
  const calB = calHtml(calM, today.getTime());
  const calFirst = calM && (calM.when || calM.asked);
  body += (page === 1 ? qaB : "") + (calFirst ? calB : "") + answerPanel(ansHit, qm) + siteCards(siteHits) + (calFirst ? "" : calB);
  if (fault) {
    body += faultHtml(fault);
  } else if (!total && qaB) {
    /* the box was the answer */
  } else if (!total) {
    body += `<p class="count">ไม่พบ · 0 pages found.</p>`;
    /* A filter, not the words, may be what emptied the page — so say which
     * ones are on and put the way out beside the news. */
    const off = activeNarrowers(url, st);
    const all = off.length > 1 ? ` · ${clearAll(url)}` : "";
    body += off.length
      ? `<p class="note">ตัวกรองที่ใช้อยู่ · filters in force: ${off.join(" · ")}${all}</p>`
      : `<p class="note">ลองคำอื่น สะกดอีกแบบ หรือตัดคำออก · try another word, another spelling, or fewer words.</p>`;
    body += judgePanel(q, qm, snapOf(), false);
  } else {
    body += `<p class="count">พบ ${num(total)} หน้า · ${num(total)} pages found${total > MAX_PAGE * st.n ? ` · แสดง ${num(MAX_PAGE * st.n)} แรก · first ${num(MAX_PAGE * st.n)} shown` : ""}</p>`;
    if (note) body += `<p class="note">${esc(note)}</p>`;
    body += judgePanel(q, qm, snapOf(), rows.length > 0);
    if (st.sort !== "rank" && total > WINDOW) {
      body += `<p class="note">เรียงใน ${num(WINDOW)} หน้าที่ตรงที่สุด · sorted within the ${num(WINDOW)} best matches</p>`;
    }
    /* Few results and a filter is on: her ask (WO-95) — offer to uncheck and
     * widen, in plain words, right under the count. The same checkboxes are in
     * the bar below; this is the one line that says loosen when the page is
     * nearly empty. */
    if (total <= FEW) {
      const off = activeNarrowers(url, st);
      if (off.length) {
        const all = off.length > 1 ? ` · ${clearAll(url)}` : "";
        body += `<p class="loosen">ผลน้อย · few results — เอาตัวกรองออกเพื่อให้กว้างขึ้น · uncheck to widen: ${off.join(" · ")}${all}</p>`;
      }
    }
    if (q && !adv) body += rfPanel(q);
    body += filterBar(url, st, facets, ax.secEn);
    body += resultList(rows, page, st.n, st.pin, ax, when);
    if (st.pin) body += exactLink(url, st.pin);
    body += pager(url, page, total, st.n);
    if (rows.length >= 5) body += (adv ? "" : simpleForm(q, st));
  }
  /* The words found two pages or fewer: the closest pages by meaning. */
  if (!fault && page === 1) body += rescueHtml(rescueRows(meaning, rows, total), esc);
  const engineDown = fault && faultKind(fault) === "engine";
  const res = html(shell(`${q} · ค้นหา · Search · มดแดง`, body, "noindex,follow"),
    engineDown ? 503 : 200, {
      "cache-control": engineDown || (mean && mean.late) || (qaD && qaD.late) ? "no-store" : `public, max-age=60, s-maxage=${CACHE_S}`,
      "x-fleet-ms": String(ms), "server-timing": timing,
      "x-fleet-match": encodeURIComponent(used).slice(0, 900).replace(/%[0-9A-F]?$/, ""),
      ...(engineDown ? { "retry-after": "60" } : {}) });
  /* A page built while the meaning search was still out is not kept: the next
   * asker gets the meaning from the colo cache (findmeaning.js). */
  if (cache && ckey && !fault && !(mean && mean.late) && !(qaD && qaD.late)) {
    try { ctx.waitUntil(cache.put(ckey, res.clone()).catch(() => {})); } catch { /* next asker fills it */ }
  }
  return res;
}

export default { fleetSearch, siteMatch, plan, planSimple, planBoolean, tokenise, phrase, spaceThai,
                 sql, narrow, siteFacetSql, dateFacetSql, facetSql, facetsFrom, keyFilters,
                 readerPin, metres, bearing, farLabel, faultKind, bangkok, openAt, openIds, nextDate,
                 cellPos, richLine, thumbHtml,
                 SORTS, IN_COLS, SINCE, HAS, HAS_KEYS, KINDS };
