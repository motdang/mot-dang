/* publish/rowstore.js: every row of api/v1/index.json comes back from the
 * packed files as the index held it (without `q`), and the refine masks say
 * what the match blob said.
 *
 *     node tests/test_rowstore.mjs            (docs/ built, emit_rows run)
 *     MD_DOCS=<docs-dir> node tests/test_rowstore.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V1 = join(process.env.MD_DOCS || join(ROOT, "docs"), "api/v1");
if (!existsSync(join(V1, "index.json")) || !existsSync(join(V1, "rows/text.json"))) {
  console.log(`SKIPPED — no ${V1}/index.json or rows/; build.py and emit_rows.mjs have not run`);
  process.exit(0);
}
const { RowStore } = await import(join(ROOT, "publish/rowstore.js"));
const { REFINE_WORDS, refineBit, findPlace, slugCandidates } = await import(join(ROOT, "publish/api.js"));

const ix = JSON.parse(readFileSync(join(V1, "index.json"), "utf8"));
const text = JSON.parse(readFileSync(join(V1, "rows/text.json"), "utf8"));
const bin = readFileSync(join(V1, "rows/cols.bin"));
const store = new RowStore(text, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

let failures = 0;
const fail = (m) => { failures++; console.log("  FAIL " + m); };

if (store.length !== ix.places.length) fail(`length ${store.length} != ${ix.places.length}`);
let bad = 0;
ix.places.forEach((r, i) => {
  const { q, ...want } = r;
  const got = store.get(i);
  if (!isDeepStrictEqual(got, want)) { if (bad++ < 3) fail(`row ${i} ${r.id}\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(got)}`); }
  const tags = r.tags || [];
  const hay = ((r.q || "") + " " + (r.name || "") + " " + (r.nameEn || "")).toLowerCase();
  for (const w of REFINE_WORDS) {
    const on = w.needles ? w.needles.some((nd) => hay.includes(nd)) : (tags.includes(w.word) || hay.includes(w.word));
    if (on !== refineBit(got._rf, w.group, w.word)) { if (bad++ < 3) fail(`row ${i} refine ${w.group}:${w.word}`); }
  }
});
if (!bad) console.log(`  ok   ${ix.places.length.toLocaleString()} rows and their refine masks match the index`);

for (const k of ["schemaVersion", "generated", "base", "attribution", "licence", "terms", "schedules"])
  if (!isDeepStrictEqual(store[k], ix[k])) fail(`head ${k}`);

let lookups = 0;
for (let i = 0; i < ix.places.length; i += 97) {
  const r = ix.places[i];
  for (const key of [r.id, r.slug]) {
    const a = findPlace(ix, key), b = store.find(key);
    const { q, ...aa } = a || {};
    if (!isDeepStrictEqual(a ? aa : null, b)) fail(`find ${key}`);
    if (slugCandidates(ix, key).length !== store.slugRows(key).length) fail(`slugRows ${key}`);
    lookups++;
  }
}
console.log(`  ok   ${lookups} id and slug lookups agree`);
if (failures) { console.log(`${failures} failed`); process.exit(1); }
