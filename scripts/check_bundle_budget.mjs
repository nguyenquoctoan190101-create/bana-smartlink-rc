import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const MAX_JS_BYTES = 500 * 1024;
const MAX_CSS_BYTES = 150 * 1024;

async function walk(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...await walk(path));
    else files.push({ path, bytes: info.size });
  }
  return files;
}

const violations = (await walk(dist)).filter(({ path, bytes }) =>
  (path.endsWith(".js") && bytes > MAX_JS_BYTES)
  || (path.endsWith(".css") && bytes > MAX_CSS_BYTES),
);

if (violations.length > 0) {
  for (const item of violations) {
    process.stderr.write(`Bundle budget exceeded: ${relative(root, item.path)} (${item.bytes} bytes)\n`);
  }
  process.exit(1);
}

process.stdout.write("Bundle budget passed (JS <= 500 KiB, CSS <= 150 KiB).\n");
