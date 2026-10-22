#!/usr/bin/env node
/* emit_rows.mjs — api/v1/rows/, the packed place rows /api/v1/search keeps in
 * the isolate (publish/rowstore.js says why and how).
 *
 *   node publish/emit_rows.mjs [docs-dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { encodeRows } from "./rowstore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(process.argv[2] || join(HERE, "..", "docs"));
const V1 = join(DOCS, "api", "v1");
const OUT = join(V1, "rows");

const t0 = Date.now();
const index = JSON.parse(readFileSync(join(V1, "index.json"), "utf8"));
const { text, bin } = encodeRows(index);
text.bv = createHash("sha1").update(bin).digest("hex").slice(0, 12);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "cols.bin"), bin);
const body = JSON.stringify(text);
writeFileSync(join(OUT, "text.json"), body);
console.log(`  rows: ${text.n.toLocaleString()} rows · text ${(body.length / 1e6).toFixed(1)} MB · ` +
            `cols ${(bin.length / 1e6).toFixed(1)} MB · bv ${text.bv} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
