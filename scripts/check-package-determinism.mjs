import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packageScript = resolve(import.meta.dirname, "package.mjs");
const archive = resolve(root, "regex-tab-dedupe-extension.zip");
const timeZones = ["UTC", "America/Los_Angeles", "Asia/Tokyo"];
const hashes = [];

for (const timeZone of timeZones) {
  const result = spawnSync(process.execPath, [packageScript], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TZ: timeZone },
  });
  if (result.status !== 0) {
    throw new Error(
      `Packaging failed in ${timeZone}: ${result.stderr || result.stdout}`,
    );
  }
  const contents = await readFile(archive);
  hashes.push(createHash("sha256").update(contents).digest("hex"));
}

if (new Set(hashes).size !== 1) {
  throw new Error(`Package hashes differ by timezone: ${hashes.join(", ")}`);
}

console.log(`Verified deterministic package ${hashes[0]} across three timezones.`);
