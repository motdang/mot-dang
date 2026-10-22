/* rowstore.js — the place rows /api/v1/search reads, packed so an isolate can
 * keep them between questions.
 *
 * api/v1/index.json is 80 MB and parses to ~230 MB of heap against a 128 MB
 * isolate (worker.js, loadIndex), so every search paid for it again: 7–15 s a
 * question, 29 bucket reads, "cold" every time (Server-Timing, 2026-10-22).
 * The search needs the rows, not the match blob `q` that /places?q= scans.
 *
 * Two files under api/v1/rows/, written by publish/emit_rows.mjs:
 *   text.json   the index's head, the dictionaries, the string columns
 *   cols.bin    every number, flag, dictionary code and list as typed arrays
 * text.json names cols.bin's hash, so a deploy caught halfway is refused and
 * the Worker walks the index as before.
 *
 * A column is chosen per field from what the values are:
 *   numbers           Float64, with a state column when any is null or absent
 *   true/false        Uint8: 0 absent, 1 null, 2 false, 3 true
 *   repeated strings  dictionary code: 0 absent, 1 null, 2+ the word
 *   other strings     a plain array in text.json (absent and null kept apart)
 *   lists of strings  offsets + dictionary codes, absent kept apart
 * Anything else rides as JSON text. get(i) gives back the row as the index
 * held it, without `q`; tests/test_rowstore.mjs compares every row.
 *
 * `_rf` on a row is two 32-bit masks of the refine words its text carries
 * (api.js REFINE_WORDS), so refineFacets reads the same answer without `q`. */
import { REFINE_WORDS } from "./api.js";

const DROP = new Set(["q"]);

/* The refine words in bit order. Rows written with another list would set
 * the wrong chips, so the Worker refuses them (worker.js, loadRows). */
export const refineSig = () => REFINE_WORDS.map((w) => w.group + ":" + w.word).join(",");
const ABSENT = 0, NULL = 1;

function refineBits(row) {
  const tags = row.tags || [];
  const hay = ((row.q || "") + " " + (row.name || "") + " " + (row.nameEn || "")).toLowerCase();
  let lo = 0, hi = 0;
  REFINE_WORDS.forEach((w, k) => {
    const on = w.needles ? w.needles.some((nd) => hay.includes(nd))
      : (tags.includes(w.word) || hay.includes(w.word));
    if (!on) return;
    if (k < 32) lo |= 1 << k; else hi |= 1 << (k - 32);
  });
  return [lo >>> 0, hi >>> 0];
}

const kindOf = (vals) => {
  let num = 0, bool = 0, str = 0, list = 0, other = 0;
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number") num++;
    else if (typeof v === "boolean") bool++;
    else if (typeof v === "string") str++;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) list++;
    else other++;
  }
  const kinds = [num && "num", bool && "bool", str && "str", list && "list", other && "json"].filter(Boolean);
  return kinds.length === 1 ? kinds[0] : kinds.length ? "json" : "empty";
};

/* index → { text, bin }. text is the object for text.json (without its
 * `bv`); bin the bytes of cols.bin. */
export function encodeRows(index) {
  if (REFINE_WORDS.length > 64) throw new Error("refine words outgrew two masks");
  const P = index.places;
  const n = P.length;
  const { places, ...head } = index;
  const keys = [];
  const seen = new Set();
  for (const r of P) for (const k of Object.keys(r)) if (!DROP.has(k) && !seen.has(k)) { seen.add(k); keys.push(k); }

  const arrays = [];      // [name, TypedArray]
  const cols = {};        // field -> description
  const strs = {};        // string columns for text.json
  const state = (k) => {  // 0 absent, 1 null, 2 value
    const s = new Uint8Array(n);
    P.forEach((r, i) => { s[i] = !(k in r) ? 0 : r[k] === null ? 1 : 2; });
    return s;
  };
  for (const k of keys) {
    const vals = P.map((r) => r[k]);
    const kind = kindOf(vals);
    if (kind === "num") {
      const a = new Float64Array(n);
      vals.forEach((v, i) => { a[i] = typeof v === "number" ? v : 0; });
      arrays.push([k, a]);
      const s = state(k);
      const whole = s.every((x) => x === 2);
      if (!whole) arrays.push([k + "#s", s]);
      cols[k] = { kind, whole };
    } else if (kind === "bool") {
      const a = new Uint8Array(n);
      P.forEach((r, i) => { a[i] = !(k in r) ? 0 : r[k] === null ? 1 : r[k] ? 3 : 2; });
      arrays.push([k, a]);
      cols[k] = { kind };
    } else if (kind === "str") {
      const distinct = new Set(vals.filter((v) => typeof v === "string"));
      if (distinct.size < n / 8) {
        const dict = [...distinct];
        const code = new Map(dict.map((w, j) => [w, j + 2]));
        const a = dict.length + 2 < 256 ? new Uint8Array(n) : dict.length + 2 < 65536 ? new Uint16Array(n) : new Uint32Array(n);
        P.forEach((r, i) => { a[i] = !(k in r) ? ABSENT : r[k] === null ? NULL : code.get(r[k]); });
        arrays.push([k, a]);
        cols[k] = { kind: "dict", dict };
      } else {
        /* null stays null; an absent value is 0, which no string field holds */
        strs[k] = P.map((r) => (!(k in r) ? 0 : r[k]));
        cols[k] = { kind: "str" };
      }
    } else if (kind === "list") {
      const distinct = new Set();
      for (const v of vals) if (Array.isArray(v)) for (const x of v) distinct.add(x);
      const dict = [...distinct];
      const code = new Map(dict.map((w, j) => [w, j]));
      let total = 0;
      for (const v of vals) if (Array.isArray(v)) total += v.length;
      const off = new Uint32Array(n + 1);
      const val = dict.length < 65536 ? new Uint16Array(total) : new Uint32Array(total);
      let at = 0;
      vals.forEach((v, i) => { off[i] = at; if (Array.isArray(v)) for (const x of v) val[at++] = code.get(x); });
      off[n] = at;
      arrays.push([k + "#o", off], [k + "#v", val], [k + "#s", state(k)]);
      cols[k] = { kind, dict };
    } else if (kind !== "empty") {
      strs[k] = P.map((r) => (!(k in r) ? 0 : JSON.stringify(r[k])));
      cols[k] = { kind: "json" };
    } else {
      arrays.push([k + "#s", state(k)]);
      cols[k] = { kind: "empty" };
    }
  }
  const rf = new Uint32Array(n * 2);
  P.forEach((r, i) => { const [lo, hi] = refineBits(r); rf[2 * i] = lo; rf[2 * i + 1] = hi; });
  arrays.push(["_rf", rf]);

  /* Lay the arrays end to end, each on an 8-byte boundary. */
  const layout = {};
  let size = 0;
  for (const [name, a] of arrays) {
    size = Math.ceil(size / 8) * 8;
    layout[name] = [a.constructor.name, size, a.length];
    size += a.byteLength;
  }
  const bin = new Uint8Array(size);
  for (const [name, a] of arrays) bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), layout[name][1]);

  return { text: { n, head, keys, cols, layout, strs, rw: refineSig() }, bin };
}

const TYPES = { Float64Array, Uint8Array, Uint16Array, Uint32Array };

/* The packed rows, read back. `text` is parsed text.json, `buf` cols.bin's
 * ArrayBuffer. The search sees it as an index: head fields, `places` to walk,
 * find(key) and slugRows(key) for findPlace / slugCandidates. */
export class RowStore {
  constructor(text, buf) {
    Object.assign(this, text.head);
    this.head = text.head;
    this.n = text.n; this.keys = text.keys; this.cols = text.cols; this.strs = text.strs;
    this.a = {};
    for (const [name, [type, off, len]] of Object.entries(text.layout))
      this.a[name] = new TYPES[type](buf, off, len);
    const ids = this.strs.id, slugs = this.strs.slug;
    this.byId = new Map();
    this.bySlug = new Map();
    for (let i = 0; i < this.n; i++) {
      const id = ids ? ids[i] : this.get(i).id;
      this.byId.set(id, i);
      const s = slugs ? slugs[i] : this.get(i).slug;
      const seen = this.bySlug.get(s);
      if (seen === undefined) this.bySlug.set(s, i);
      else if (Array.isArray(seen)) seen.push(i);
      else this.bySlug.set(s, [seen, i]);
    }
  }

  get(i) {
    const row = {};
    const a = this.a;
    for (const k of this.keys) {
      const c = this.cols[k];
      switch (c.kind) {
        case "num": {
          if (c.whole) { row[k] = a[k][i]; break; }
          const s = a[k + "#s"][i];
          if (s === 2) row[k] = a[k][i]; else if (s === 1) row[k] = null;
          break;
        }
        case "bool": {
          const v = a[k][i];
          if (v) row[k] = v === 1 ? null : v === 3;
          break;
        }
        case "dict": {
          const v = a[k][i];
          if (v) row[k] = v === NULL ? null : c.dict[v - 2];
          break;
        }
        case "str": {
          const v = this.strs[k][i];
          if (v !== 0) row[k] = v;
          break;
        }
        case "json": {
          const v = this.strs[k][i];
          if (v !== 0) row[k] = JSON.parse(v);
          break;
        }
        case "list": {
          const s = a[k + "#s"][i];
          if (s === 1) { row[k] = null; break; }
          if (s === 0) break;
          const off = a[k + "#o"], val = a[k + "#v"], out = [];
          for (let j = off[i]; j < off[i + 1]; j++) out.push(c.dict[val[j]]);
          row[k] = out;
          break;
        }
        case "empty": {
          if (a[k + "#s"][i] === 1) row[k] = null;
          break;
        }
      }
    }
    Object.defineProperty(row, "_rf", { value: [a._rf[2 * i], a._rf[2 * i + 1]], enumerable: false });
    return row;
  }

  find(key) {
    const k = String(key || "").trim();
    if (!k) return null;
    const i = this.byId.get(k);
    if (i !== undefined) return this.get(i);
    const s = this.bySlug.get(k);
    return s !== undefined && !Array.isArray(s) ? this.get(s) : null;
  }

  slugRows(key) {
    const s = this.bySlug.get(String(key || "").trim());
    return Array.isArray(s) ? s.map((i) => this.get(i)) : [];
  }

  /* Every row in index order, one at a time. */
  *[Symbol.iterator]() { for (let i = 0; i < this.n; i++) yield this.get(i); }
  get places() { return this; }
  get length() { return this.n; }
}
