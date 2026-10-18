// Verifies that every internal href/src in the exported site points to an existing file.
// Usage: BASE_PATH=/repo node demo/check-links.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE_PATH ?? "";
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const pages = walk("out").filter((f) => f.endsWith(".html"));
const missing = new Set();
let checked = 0;
for (const f of pages) {
  for (const [, url] of readFileSync(f, "utf8").matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    if (base && !url.startsWith(base + "/") && url !== base) { missing.add(`${url} (no basePath) in ${f}`); continue; }
    const rel = base ? url.slice(base.length) : url;
    const p = join("out", rel);
    checked++;
    if (!(existsSync(p) && statSync(p).isFile()) && !existsSync(join(p, "index.html"))) missing.add(`${url} in ${f}`);
  }
}
console.log(`${pages.length} pages, ${checked} links checked, ${missing.size} broken`);
for (const m of [...missing].slice(0, 20)) console.log("  BROKEN", m);
process.exit(missing.size ? 1 : 0);
