/* mot-dang public API — the query engine, with nothing platform-specific in it.
 *
 * WHY IT IS ITS OWN FILE
 * ----------------------
 * worker.js is routing, R2 and headers; this is the part that has opinions
 * about what a query MEANS. Splitting them lets tests/test_api_worker.js run
 * the whole filter/sort/page path under plain node against the real
 * docs/api/v1/index.json, with no Cloudflare and no network. A query rule that
 * cannot be tested without deploying is a rule nobody checks.
 *
 * WHAT THE ENGINE PROMISES
 * ------------------------
 * The handling of absence holds all the way into the JSON: a place whose
 * hours we do not hold is `openNow: null`, never `false`, and `open_now=1`
 * excludes it rather than calling it shut. Same for coordinates — a record
 * with `geoPrecision: "needs-pin"` has no lat/lng and simply cannot answer a
 * `near=` query, so it drops out of that query and stays in every other one.
 * Silence is reported as silence.
 *
 * KEY STABILITY
 * -------------
 * Every key a response carries is frozen for the life of /api/v1/ and locked
 * by tests/test_api.py. Keys may be ADDED to v1; none is ever removed,
 * renamed, or retyped. A change that would break a reader gets /api/v2/ and
 * v1 keeps running beside it. See docs/api/v1/schema.json, which is generated
 * from the same frozen list rather than written by hand.
 */

export const SCHEMA_VERSION = 1;

/* Limits, stated once. A reader that asks for more gets the cap, never an
 * error — a 400 for wanting too much is a rude answer to a fair question. */
export const LIMIT_DEFAULT = 20;
export const LIMIT_MAX = 200;
export const RADIUS_DEFAULT = 2000;
export const RADIUS_MAX = 50000;

/* The public shape of one result. Frozen for v1. `distanceM` appears only for
 * a near= query and `openNow` only when hours are held, because a key whose
 * value would be a guess is better absent — see schema.json's "conditional". */
export const RESULT_KEYS = [
  "id", "url", "apiUrl", "province", "name", "nameEn",
  "categories", "subcategories", "lat", "lng", "geoPrecision",
  "hours", "openNow", "antRank", "has", "tags", "lenses", "facets",
  "confidence", "osmDerived", "updatedAt", "photoUrl", "distanceM",
];

/* The envelope every list response carries. Frozen for v1. */
export const ENVELOPE_KEYS = [
  "schemaVersion", "generated", "query", "total", "count", "limit", "offset",
  "results", "attribution", "licence", "terms",
];

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/* ---------------------------------------------------------------- helpers */

/* Lowercase and drop the punctuation a reader types but a record does not
 * carry. Thai is left exactly as it is: it has no case and no spaces, so a
 * bare substring test is the correct primitive there, not a worse one. */
export function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const list = (v) =>
  norm(v).split(/[, ]+/).map((x) => x.trim()).filter(Boolean);

/* Every set filter compares case-insensitively, because the vocabularies are
 * not all one case and a reader cannot be expected to know which is which:
 * category keys are lower-kebab ("home-services") while the ant bits are
 * camel ("nameTh", "claimed"). list() lowercases the query, so the row side
 * has to be lowered at the point of comparison — without this, has=nameTh
 * matched nothing at all and looked exactly like "no such places". */
const anyOf = (rowVals, wanted) => {
  const have = new Set((rowVals || []).map((x) => String(x).toLowerCase()));
  return wanted.some((w) => have.has(w));
};
const allOf = (rowVals, wanted) => {
  const have = new Set((rowVals || []).map((x) => String(x).toLowerCase()));
  return wanted.every((w) => have.has(w));
};

/* Metres between two points. Haversine on a sphere: at city scale the
 * difference from a proper geodesic is under a metre, and a radius filter that
 * is a metre out at 2 km is not a filter anyone can feel. */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLng = (lng2 - lng1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Minute of the week in Asia/Bangkok, Monday 00:00 = 0.
 *
 * Intl does the zone, not a hardcoded +7: Thailand has not changed its offset
 * since 1920 and is not expected to, but an offset written into code is a
 * silent bug the day a rule changes, and asking the platform costs nothing. */
export function minuteOfWeek(date = new Date(), timeZone = "Asia/Bangkok") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((x) => x.type === t)?.value || "";
  const day = DAYS.indexOf(get("weekday").slice(0, 2));
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  if (day < 0 || Number.isNaN(h) || Number.isNaN(m)) return null;
  return day * 1440 + h * 60 + m;
}

/* "Mo 18:30" or "Sa 09:00" → minute of week. The explicit form, for a reader
 * asking about a time that is not now — a trip planner's whole job. */
export function parseOpenAt(s) {
  const m = String(s || "").trim().match(/^([A-Za-z]{2})[ ,]+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const day = DAYS.indexOf(m[1][0].toUpperCase() + m[1][1].toLowerCase());
  const h = parseInt(m[2], 10);
  const mi = parseInt(m[3], 10);
  if (day < 0 || h > 23 || mi > 59) return null;
  return day * 1440 + h * 60 + mi;
}

/* null — not false — when the schedule is unknown. The whole open-now feature
 * rests on this distinction: build_open_lamps.py parses 4,343 of 4,375 hours
 * strings and refuses to guess at the other 32, and the API must not undo that
 * accuracy by rendering "we don't know" as "closed". */
export function isOpenAt(schedules, sched, minute) {
  if (sched == null || sched < 0 || minute == null) return null;
  const iv = schedules[sched];
  if (!iv) return null;
  for (const [a, b] of iv) if (minute >= a && minute < b) return true;
  return false;
}

/* ------------------------------------------------------------ the query */

/* Read the accepted params off a URLSearchParams, clamping rather than
 * refusing. Returns the parsed query AND the echo that goes back in the
 * envelope, so a reader can always see what we thought they asked. */
/* A CITY NAME IN q IS THE PROVINCE FILTER (Nan, 2026-09-10: "Adding a city
 * name shouldn't fuck things up for users"). Every row now carries its
 * province words, so the tokens would land anyway; lifting them also narrows
 * to the province and stops "chiang" and "rai" counting as two more words a
 * name has to contain. A query naming both cities lifts neither. */
const PROVINCE_IN_Q = [["cr", ["เชียงราย", "chiang rai", "chiangrai"]],
                       ["cm", ["เชียงใหม่", "chiang mai", "chiangmai"]]];
export function liftProvince(q) {
  const hits = PROVINCE_IN_Q.filter(([, als]) => als.some((a) => q.includes(a)));
  if (hits.length !== 1) return { q, province: null };
  let rest = q;
  for (const a of hits[0][1]) rest = rest.split(a).join(" ");
  return { q: rest.replace(/\s+/g, " ").trim(), province: hits[0][0] };
}

export function parseQuery(sp) {
  const lifted = liftProvince(norm(sp.get("q") || ""));
  const q = lifted.q;
  const near = (sp.get("near") || "").split(",").map((x) => parseFloat(x));
  const hasNear = near.length === 2 && near.every((n) => Number.isFinite(n));
  const int = (name, dflt, min, max) => {
    const v = parseInt(sp.get(name) ?? "", 10);
    if (!Number.isFinite(v)) return dflt;
    return Math.min(max, Math.max(min, v));
  };
  const openAt = sp.get("open_at") ? parseOpenAt(sp.get("open_at")) : null;
  /* bbox=west,south,east,north — the viewport as a question (WO-74 L1, wired
   * for WO-77). Clamped to sane degrees; anything else is ignored and said. */
  const bb = (sp.get("bbox") || "").split(",").map((x) => parseFloat(x));
  const bbox = bb.length === 4 && bb.every(Number.isFinite)
    && bb[0] < bb[2] && bb[1] < bb[3]
    && bb[0] >= -180 && bb[2] <= 180 && bb[1] >= -90 && bb[3] <= 90
    ? { w: bb[0], s: bb[1], e: bb[2], n: bb[3] } : null;
  const parsed = {
    q,
    tokens: q ? q.split(" ").filter(Boolean) : [],
    province: (sp.get("province") || "").toLowerCase().trim() || lifted.province,
    cat: list(sp.get("cat")),
    sub: list(sp.get("sub")),
    tag: list(sp.get("tag")),
    lens: list(sp.get("lens")),
    facet: list(sp.get("facet")),
    has: list(sp.get("has")),
    minAnts: int("min_ants", 0, 0, 9),
    near: hasNear ? { lat: near[0], lng: near[1] } : null,
    bbox,
    radius: int("radius", RADIUS_DEFAULT, 1, RADIUS_MAX),
    openNow: ["1", "true", "yes"].includes((sp.get("open_now") || "").toLowerCase()),
    openAt,
    sort: (sp.get("sort") || "").toLowerCase(),
    limit: int("limit", LIMIT_DEFAULT, 1, LIMIT_MAX),
    offset: int("offset", 0, 0, 1e6),
  };
  /* Distance is the only sane default when a reader gave us a point; ant rank
   * is the only sane one when they did not, because "most completely known"
   * is the nearest thing this directory has to a merit order it can defend. */
  if (!["distance", "ants", "name", "relevance"].includes(parsed.sort))
    parsed.sort = parsed.near ? "distance" : parsed.q ? "relevance" : "ants";
  return parsed;
}

/* What goes back in `query` — only the params that were actually given, so
 * the echo reads as "here is what you asked", not as a dump of our defaults. */
export function echoQuery(sp, p) {
  const out = {};
  for (const k of ["q", "province", "cat", "sub", "tag", "lens", "facet",
                   "has", "min_ants", "near", "radius", "bbox", "open_now", "open_at",
                   "sort", "limit", "offset"]) {
    if (sp.has(k)) out[k] = sp.get(k);
  }
  out.sort = p.sort;
  out.limit = p.limit;
  out.offset = p.offset;
  if (sp.has("open_at") && p.openAt == null) out.open_at_ignored = "want e.g. 'Sa 18:30'";
  if (sp.has("near") && !p.near) out.near_ignored = "want 'lat,lng'";
  if (sp.has("bbox") && !p.bbox) out.bbox_ignored = "want 'west,south,east,north'";
  return out;
}

/* One index row → the public result shape. The index row's keys are short
 * because it travels 13,000 times; the public row's are long because a person
 * reads them. The mapping lives here alone so the two cannot drift. */
export function present(row, base, p, schedules, minute) {
  const out = {
    id: row.id,
    url: base + `${row.province}/p/${row.slug}.html`,
    apiUrl: base + `api/v1/places/${row.id}`,
    province: row.province,
    name: row.name,
    nameEn: row.nameEn ?? null,
    categories: row.cat || [],
    subcategories: row.sub || [],
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    geoPrecision: row.geoPrecision,
    hours: row.hours ?? null,
    openNow: isOpenAt(schedules, row.sched, minute),
    antRank: row.antRank,
    has: row.has || [],
    tags: row.tags || [],
    lenses: row.lenses || [],
    facets: row.facets || [],
    confidence: row.confidence,
    osmDerived: !!row.osmDerived,
    updatedAt: row.updatedAt ?? null,
    /* Only the real, credited photographs get a URL. The placeholder every
     * unphotographed listing wears on its page is furniture, not a picture of
     * the place, and handing it over as one would be a lie in a field. */
    photoUrl: row.photo ? base + "photos/" + row.photo : null,
  };
  if (p.near && row.lat != null)
    out.distanceM = Math.round(distanceM(p.near.lat, p.near.lng, row.lat, row.lng));
  return out;
}

/* ONE PREDICATE, TWO CALLERS. /api/v1/places walks the whole index through
 * this; /api/v1/search walks the words' own hits through it, so a filter means
 * the same thing whichever endpoint a reader reached (WO-87). Two copies of
 * this loop is how a `tag=` that narrows on one endpoint comes to widen on the
 * other, and nobody would see it until a chip on the results page and the same
 * chip on the API disagreed about a count.
 *
 * Returns `false` for a row that is out, and otherwise the distance in metres
 * when `near` was given or `null` when it was not — so the caller keeps the
 * one number it would have had to compute again to sort by.
 *
 * `opts.words` is the token scan, which the search endpoint does NOT want: the
 * words there have already been answered by searchcore, tiers and all, and
 * re-running a substring pass over them would throw away everything that
 * ranking knows.
 */
export function rowMatches(row, p, schedules, minute, opts = {}) {
  if (p.province && row.province !== p.province) return false;
  if (p.cat.length && !anyOf(row.cat, p.cat)) return false;
  if (p.sub.length && !anyOf(row.sub, p.sub)) return false;
  if (p.tag.length && !anyOf(row.tags, p.tag)) return false;
  if (p.lens.length && !anyOf(row.lenses, p.lens)) return false;
  /* facet and has are ANDs, not ORs: each one is a requirement a reader is
   * standing on ("it must have a phone AND be wheelchair-accessible"),
   * whereas a list of categories is a set of acceptable answers. */
  if (p.facet.length && !allOf(row.facets, p.facet)) return false;
  if (p.has.length && !allOf(row.has, p.has)) return false;
  if (p.minAnts && row.antRank < p.minAnts) return false;

  if (opts.words && p.tokens.length && !p.tokens.every((t) => row.q.includes(t))) return false;

  /* A box is a question about where things ARE; a row with no pin cannot
   * answer it and leaves the set, exactly as it does for near=. */
  if (p.bbox) {
    if (row.lat == null) return false;
    if (row.lng < p.bbox.w || row.lng > p.bbox.e || row.lat < p.bbox.s || row.lat > p.bbox.n) return false;
  }
  let d = null;
  if (p.near) {
    if (row.lat == null) return false;   // unpinned: cannot answer, does not pretend to
    d = distanceM(p.near.lat, p.near.lng, row.lat, row.lng);
    if (d > p.radius) return false;
  }
  /* Asking "open now" of a place whose hours nobody holds has no true
   * answer, so it is not offered one — it leaves the result set rather than
   * being reported shut. The count in `total` says how many DID answer. */
  if (minute != null && isOpenAt(schedules, row.sched, minute) !== true) return false;
  return d;
}

/* Names compare in Thai collation, through one Collator shared by every path
 * that orders places, so the index walk, the grid and /search cannot disagree
 * on a tie. */
const THAI = new Intl.Collator("th");
export const cmpPlaceName = (a, b) => THAI.compare(String(a.name), String(b.name));

/* The /places default order (sort=ants): ground truth (truth_layer.py; Nan,
 * 2026-10-12: "rank places by ground truth too"), then ant rank, then name. A
 * row without groundTruth counts 0. queryPlaces, gridOrder and the worker's
 * /search walk all sort with this; on 2026-10-13 the index walk alone lacked
 * ground truth and answered a box with different rows from the grid. */
export const cmpPlaceDefault = (a, b) =>
  (b.groundTruth || 0) - (a.groundTruth || 0) || b.antRank - a.antRank || cmpPlaceName(a, b);

/* The whole filter/sort/page path. `index` is the parsed docs/api/v1/index.json. */
export function queryPlaces(index, sp, now = new Date()) {
  const p = parseQuery(sp);
  const schedules = index.schedules || [];
  /* open_at wins over open_now when both are given: an explicit time is a
   * stated intention and "now" is only ever a default. */
  const minute = p.openAt != null ? p.openAt
    : p.openNow ? minuteOfWeek(now) : null;

  const hits = [];
  for (const row of index.places) {
    const d = rowMatches(row, p, schedules, minute, { words: true });
    if (d === false) continue;
    hits.push([row, d]);
  }

  const cmpName = (a, b) => cmpPlaceName(a[0], b[0]);
  if (p.sort === "distance" && p.near) hits.sort((a, b) => a[1] - b[1] || cmpName(a, b));
  else if (p.sort === "name") hits.sort(cmpName);
  else if (p.sort === "relevance" && p.tokens.length) {
    /* Relevance here is deliberately shallow and explainable: a name that
     * starts with what you typed beats one that merely contains it, and ant
     * rank breaks the tie. Anything cleverer belongs in the semantic endpoint
     * at ask.motdang.net, which has embeddings and this does not. */
    const score = (r) => {
      const n = norm(r.name) + " " + norm(r.nameEn || "");
      let s = 0;
      for (const t of p.tokens) {
        if (n.startsWith(t)) s += 3;
        else if (n.includes(" " + t)) s += 2;
        else if (n.includes(t)) s += 1;
      }
      return s;
    };
    hits.sort((a, b) => score(b[0]) - score(a[0]) || b[0].antRank - a[0].antRank || cmpName(a, b));
  } else hits.sort((a, b) => cmpPlaceDefault(a[0], b[0]));

  const page = hits.slice(p.offset, p.offset + p.limit);
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: index.generated,
    query: echoQuery(sp, p),
    total: hits.length,
    count: page.length,
    limit: p.limit,
    offset: p.offset,
    results: page.map(([row]) => present(row, index.base, p, schedules, minute)),
    attribution: index.attribution,
    licence: index.licence,
    terms: index.terms,
  };
}

/* id or slug, either way. A reader who has a page URL holds the slug and
 * nothing else, and telling them their own URL is not a valid key would be a
 * riddle, not an API.
 *
 * The two namespaces are kept apart and the id is tried first, because they
 * are not equally trustworthy. An id is unique by construction. A slug is a
 * filename stem — it drops the Thai (which does not survive as ASCII) and
 * keeps the digits, so two records whose ids differ only in a word can land
 * on one slug. 75 slugs in the corpus are shared that way, every one of them
 * the same shop entered in two curated registers.
 *
 * Where a slug is shared, this returns NOTHING rather than one of them. The
 * caller reports the ambiguity and hands back both ids. Picking the first
 * would be right most of the time, which is exactly what makes it the wrong
 * habit for a lookup — the day a shared slug is two different places, a
 * guessing endpoint serves the wrong one and says nothing.
 *
 * The tables hang off a WeakMap rather than off the index object: the
 * descriptor endpoint serialises that object wholesale, and a Map bolted onto
 * it as a property would ride along into the JSON as an empty {}. Cached work
 * should be invisible to anyone reading the thing it was cached on. */
const BY_KEY = new WeakMap();
function tables(index) {
  let t = BY_KEY.get(index);
  if (!t) {
    t = { byId: new Map(), bySlug: new Map() };
    for (const r of index.places) {
      t.byId.set(r.id, r);
      const seen = t.bySlug.get(r.slug);
      if (seen) seen.push(r);
      else t.bySlug.set(r.slug, [r]);
    }
    BY_KEY.set(index, t);
  }
  return t;
}

export function findPlace(index, key) {
  if (index.find) return index.find(key);       // the packed rows (rowstore.js)
  const k = String(key || "").trim();
  if (!k) return null;
  const t = tables(index);
  const byId = t.byId.get(k);
  if (byId) return byId;
  const rows = t.bySlug.get(k);
  return rows && rows.length === 1 ? rows[0] : null;
}

/* The records a shared slug could have meant — empty unless it is shared. */
export function slugCandidates(index, key) {
  if (index.slugRows) return index.slugRows(key);
  const rows = tables(index).bySlug.get(String(key || "").trim());
  return rows && rows.length > 1 ? rows : [];
}

/* ------------------------------------------------------- refine words */

/* The words the search's refine chips look for in a row's text (worker.js,
 * refineFacets). Here so publish/rowstore.js can mark each row with them at
 * build time and the Worker need not hold the match blob. */
export const RF_CUISINE = ("japanese korean thai chinese italian indian burmese vietnamese mexican "
  + "french american isan northern lanna muslim halal vegetarian vegan seafood noodle sushi "
  + "ramen shabu sukiyaki bbq buffet steak pizza burger dimsum izakaya khaosoi curry dessert "
  + "bakery coffee tea").split(" ");
export const RF_SERVICE = ("alterations mend hemming zip repair tailoring dermatology cosmetic dental "
  + "braces massage laundry printing framing").split(" ");
export const RF_FEATURE = { outdoor: ["outdoor", "นั่งนอก"], wifi: ["wifi", "ไวไฟ"], halal: ["halal", "ฮาลาล"],
  delivery: ["delivery", "ส่งถึง"], parking: ["parking", "จอดรถ"], aircon: ["air-con", "แอร์"],
  "24h": ["24"], takeaway: ["takeaway", "กลับบ้าน"] };
/* One list, one bit each: [group, word] in a fixed order. */
export const REFINE_WORDS = [
  ...RF_CUISINE.map((word) => ({ group: "cuisine", word })),
  ...RF_SERVICE.map((word) => ({ group: "service", word })),
  ...Object.entries(RF_FEATURE).map(([word, needles]) => ({ group: "feature", word, needles })),
];
const REFINE_AT = new Map(REFINE_WORDS.map((w, k) => [w.group + ":" + w.word, k]));
export function refineBit(bits, group, word) {
  const k = REFINE_AT.get(group + ":" + word);
  if (k === undefined) return false;
  return k < 32 ? ((bits[0] >>> k) & 1) === 1 : ((bits[1] >>> (k - 32)) & 1) === 1;
}

/* ------------------------------------------------------------ the grid */

/* BBOX WITHOUT THE INDEX (2026-10-11). The maps ask nine boxes per pan or
 * zoom, and every box that missed the colo cache paid for index.json: 75 MB,
 * read from R2 and parsed on each request because no isolate can keep it.
 * Measured that day: 6.8 s per miss, 2.5 s for /health alone. The box itself
 * was never the cost.
 *
 * So the build also writes api/v1/grid/: meta.json holds, for every pinned
 * row, only what a box query reads (lat, lng, ant rank, province) in the
 * order /places would sort them, plus where the whole row sits: one of a few
 * hundred chunk files of at most GRID_CHUNK rows, one per quadtree cell, so a
 * box touches few of them. A box query scans meta in memory, counts `total`, and
 * reads only the chunks its page lands in.
 *
 * The answer is the one queryPlaces gives, byte for byte; tests/
 * test_api_worker.js compares the two. Only queries the grid can answer
 * exactly take this path (gridEligible); the rest still walk the index. */
export const GRID_CHUNK = 400;   // a cell holding more rows than this splits in four
const GRID_BITS = 20;            // cell sides: 360 / 2^20 degrees, about 38 m

/* The /places default order (cmpPlaceDefault), then index position
 * (Array.prototype.sort is stable). Over a subset this is the order queryPlaces
 * gives that subset, so one global rank serves every box. */
export function gridOrder(places) {
  return [...places.keys()].sort((i, j) => cmpPlaceDefault(places[i], places[j]));
}

function zkey(x, y) {
  let k = 0;
  for (let b = GRID_BITS - 1; b >= 0; b--) k = k * 4 + (((y >> b) & 1) << 1) + ((x >> b) & 1);
  return k;
}

/* index → { meta, chunks }. meta's columns run in /places order; `ch`/`at`
 * say which chunk holds the full row and where. A chunk row is the index row
 * without `q`, the match blob: a box query has no words to match.
 *
 * STABLE CHUNKS (2026-10-13, Nan's "do a": R2 bills each changed object). The
 * world is cut into a fixed quadtree and a cell that holds more than
 * GRID_CHUNK rows splits in four; each leaf is one chunk, named by its cell.
 * Adding or removing a place changes its own leaf and no other, unless the
 * count crosses the limit. meta.cn names the chunks and meta.cv holds each
 * one's hash; a chunk carries its own hash and is used only when it matches. */
export function buildGrid(index) {
  const P = index.places;
  const pinned = [...P.keys()].filter((i) => P[i].lat != null);
  const N = 2 ** GRID_BITS - 1;
  const qx = (v) => Math.max(0, Math.min(N, Math.floor(((v + 180) / 360) * (N + 1))));
  const qy = (v) => Math.max(0, Math.min(N, Math.floor(((v + 90) / 180) * (N + 1))));
  const z = new Map(pinned.map((i) => [i, zkey(qx(P[i].lng ?? 0), qy(P[i].lat))]));
  const spatial = [...pinned].sort((a, b) => z.get(a) - z.get(b) || a - b);
  const cells = [];                       // { name, rows: [place index] }
  const cut = (lo, hi, level) => {
    if (hi - lo <= GRID_CHUNK || level === GRID_BITS) {
      const prefix = Math.floor(z.get(spatial[lo]) / 4 ** (GRID_BITS - level));
      cells.push({ name: "g" + level.toString(36) + "-" + prefix.toString(36), rows: spatial.slice(lo, hi) });
      return;
    }
    const unit = 4 ** (GRID_BITS - level - 1);
    let a = lo;
    while (a < hi) {
      const quad = Math.floor(z.get(spatial[a]) / unit);
      let b = a + 1;
      while (b < hi && Math.floor(z.get(spatial[b]) / unit) === quad) b++;
      cut(a, b, level + 1);
      a = b;
    }
  };
  if (spatial.length) cut(0, spatial.length, 0);
  const where = new Map();
  const chunks = cells.map((cell, c) => cell.rows.map((i, at) => {
    const { q, ...row } = P[i];
    where.set(i, [c, at]);
    return row;
  }));
  const provs = [...new Set(pinned.map((i) => P[i].province))].sort();
  const meta = {
    generated: index.generated, base: index.base,
    attribution: index.attribution, licence: index.licence, terms: index.terms,
    chunks: chunks.length, cn: cells.map((cell) => cell.name), provs,
    lat: [], lng: [], ant: [], prov: [], ch: [], at: [],
  };
  for (const i of gridOrder(P)) {
    if (!where.has(i)) continue;
    const r = P[i];
    meta.lat.push(r.lat); meta.lng.push(r.lng ?? null); meta.ant.push(r.antRank);
    meta.prov.push(provs.indexOf(r.province));
    const [c, a] = where.get(i);
    meta.ch.push(c); meta.at.push(a);
  }
  return { meta, chunks };
}

/* A box and nothing the grid does not hold: no words, no point, no hours,
 * no set filters, and the default order (sort=name is a different one). */
export function gridEligible(p) {
  return !!p.bbox && !p.tokens.length && !p.near && !p.openNow && p.openAt == null
    && p.sort !== "name" && !p.cat.length && !p.sub.length && !p.tag.length
    && !p.lens.length && !p.facet.length && !p.has.length;
}

/* queryPlaces for a box, over meta and the chunks its page needs.
 * getChunk(c) resolves to that chunk's rows. null when not eligible. */
export async function queryPlacesGrid(meta, getChunk, sp) {
  const p = parseQuery(sp);
  if (!gridEligible(p)) return null;
  const { w, s, e, n } = p.bbox;
  const { lat, lng, ant, prov, ch, at } = meta;
  const want = p.province ? meta.provs.indexOf(p.province) : null;
  const lo = p.offset, hi = p.offset + p.limit;
  const page = [];
  let total = 0;
  for (let i = 0; i < lat.length; i++) {
    if (want !== null && prov[i] !== want) continue;
    if (p.minAnts && ant[i] < p.minAnts) continue;
    if (lng[i] < w || lng[i] > e || lat[i] < s || lat[i] > n) continue;
    if (total >= lo && total < hi) page.push(i);
    total++;
  }
  const need = [...new Set(page.map((i) => ch[i]))];
  const got = new Map(await Promise.all(need.map(async (c) => [c, await getChunk(c)])));
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: meta.generated,
    query: echoQuery(sp, p),
    total,
    count: page.length,
    limit: p.limit,
    offset: p.offset,
    results: page.map((i) => present(got.get(ch[i])[at[i]], meta.base, p, [], null)),
    attribution: meta.attribution,
    licence: meta.licence,
    terms: meta.terms,
  };
}
