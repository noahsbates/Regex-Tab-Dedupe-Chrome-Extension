import { access, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../dist");
const requiredFiles = [
  "manifest.json",
  "popup.html",
  "assets/background.js",
  "logo.png",
];

for (const file of requiredFiles) {
  await access(resolve(root, file));
}

const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(
  JSON.stringify([...manifest.permissions].sort()) ===
    JSON.stringify(["alarms", "storage", "tabs", "webNavigation"]),
  "permissions must be alarms, storage, tabs, and webNavigation",
);
assert(
  manifest.host_permissions === undefined,
  "host permissions are forbidden",
);
assert(
  manifest.background?.service_worker === "assets/background.js",
  "background service worker path is wrong",
);
assert(manifest.action?.default_popup === "popup.html", "popup path is wrong");
assert(
  manifest.action?.default_icon === "logo.png",
  "action logo path is wrong",
);
assert(
  JSON.stringify(manifest.icons) === JSON.stringify({ 128: "logo.png" }),
  "manifest must reference only the canonical 128px logo",
);

const popup = await readFile(resolve(root, "popup.html"), "utf8");
assert(
  !/<script[^>]+src=["']https?:/i.test(popup),
  "remote scripts are forbidden",
);
assert(
  !/<link[^>]+href=["']https?:/i.test(popup),
  "remote styles are forbidden",
);

const allFiles = await walk(root);
const relativeFiles = allFiles.map((file) =>
  relative(root, file).replaceAll("\\", "/"),
);
const allowedFiles = [
  /^assets\/background\.js$/,
  /^assets\/popup\.js$/,
  /^assets\/popup-[A-Za-z0-9_-]+\.css$/,
  /^assets\/chrome-[A-Za-z0-9_-]+\.js$/,
  /^logo\.png$/,
  /^manifest\.json$/,
  /^popup\.html$/,
];
for (const pattern of allowedFiles) {
  assert(
    relativeFiles.filter((file) => pattern.test(file)).length === 1,
    `production output must contain exactly one file matching ${pattern}`,
  );
}
for (const file of relativeFiles) {
  assert(
    allowedFiles.some((pattern) => pattern.test(file)),
    `unexpected file in production output: ${file}`,
  );
}
assert(
  allFiles.every((file) => !file.endsWith(".map")),
  "production source maps must not ship",
);

console.log(
  `Validated ${allFiles.length} allowlisted extension files in dist/.`,
);

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
