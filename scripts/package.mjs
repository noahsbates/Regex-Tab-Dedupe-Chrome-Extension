import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { zipSync } from "fflate";

const root = resolve(import.meta.dirname, "../dist");
const output = resolve(
  import.meta.dirname,
  "../regex-tab-dedupe-extension.zip",
);
const paths = (await walk(root)).sort();
const files = {};
const deterministicTimestamp = new Date(1980, 0, 2, 0, 0, 0);
for (const path of paths) {
  const name = relative(root, path).replaceAll("\\", "/");
  files[name] = [
    new Uint8Array(await readFile(path)),
    { mtime: deterministicTimestamp },
  ];
}

await writeFile(output, zipSync(files, { level: 9 }));
console.log(`Packaged ${paths.length} files into ${output}.`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}
