// Static wiring check: every named import must exist as an export in the target
// module, and every script/link referenced by index.html must exist on disk.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const jsRoot = join(root, "public/js");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
})(jsRoot);

const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const src = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  exportCache.set(file, names);
  return names;
}

let bad = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\})?\s*(?:from)?\s*["'](\.[^"']+)["']/g)) {
    const named = m[2] || "";
    const target = resolve(dirname(file), m[3]);
    if (!existsSync(target)) {
      console.log(`MISSING FILE: ${file} -> ${m[3]}`);
      bad++;
      continue;
    }
    const exp = exportsOf(target);
    for (const part of named.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!exp.has(name)) {
        console.log(`MISSING EXPORT: ${name} (imported by ${file.replace(root + "/", "")} from ${m[3]})`);
        bad++;
      }
    }
  }
}

const html = readFileSync(join(root, "public/index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|data:|#)/.test(ref)) continue;
  const p = join(root, "public", ref);
  if (!existsSync(p)) {
    console.log(`MISSING ASSET: index.html -> ${ref}`);
    bad++;
  }
}

console.log(bad === 0 ? "ALL IMPORTS/ASSETS OK" : `${bad} PROBLEM(S)`);
process.exit(bad === 0 ? 0 : 1);
