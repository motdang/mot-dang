#!/usr/bin/env node
/* emit_grid.mjs — api/v1/grid/, the box index the Worker answers
 * /api/v1/places?bbox= from without reading index.json. What it holds and
 * why: publish/api.js, "the grid".
 *
 *   docs/api/v1/grid/meta.json      v, cn (chunk names), cv (chunk hashes), the
 *                                   envelope's fields, one column per field a
 *                                   box query reads, in /places order
 *   docs/api/v1/grid/<cn>.json …    { v, rows } — the whole rows of one cell
 *
 * A chunk's `v` is the hash of its own rows; meta.cv lists them and meta.v
 * hashes everything. The Worker keeps a chunk only when its v matches meta's
 * entry, so a deploy caught halfway (new meta, old chunk) falls back to the
 * index instead of answering with the wrong row. A place added or removed
 * rewrites its own cell's file and meta, no other chunk (api.js, buildGrid).
 *
 *   node publish/emit_grid.mjs [docs-dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildGrid } from "./api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(process.argv[2] || join(HERE, "..", "docs"));
const V1 = join(DOCS, "api", "v1");
const OUT = join(V1, "grid");

const t0 = Date.now();
const index = JSON.parse(readFileSync(join(V1, "index.json"), "utf8"));
const { meta, chunks } = buildGrid(index);

const bodies = chunks.map((rows) => JSON.stringify(rows));
const hash = (t) => createHash("sha1").update(t).digest("hex").slice(0, 12);
meta.cv = bodies.map(hash);
const h = createHash("sha1");
h.update(JSON.stringify(meta));
const v = h.digest("hex").slice(0, 12);

mkdirSync(OUT, { recursive: true });
const name = (c) => meta.cn[c] + ".json";
// A chunk this run does not name stays where it is: a publish never deletes
// under api/ (publish/safety.py), and the Worker opens only what meta names.
// api_layer.py carries retired chunks from the last build into docs.next/.
bodies.forEach((b, c) => writeFileSync(join(OUT, name(c)), `{"v":"${meta.cv[c]}","rows":${b}}`));
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ v, ...meta }));

const mb = (JSON.stringify(meta).length / 1e6).toFixed(1);
console.log(`  grid: ${meta.lat.length.toLocaleString()} pinned rows · ${chunks.length} chunks · ` +
            `meta ${mb} MB · v ${v} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
