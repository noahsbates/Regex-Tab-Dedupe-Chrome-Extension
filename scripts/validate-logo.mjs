import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

const path = new URL("../public/logo.png", import.meta.url);
const logo = PNG.sync.read(await readFile(path));

assert(logo.width === 128 && logo.height === 128, "logo must be 128x128 px");

const bounds = visibleBounds(logo);
assert(bounds !== null, "logo must contain visible artwork");
assert(
  bounds.left === 16 &&
    bounds.top === 16 &&
    bounds.right === 111 &&
    bounds.bottom === 111,
  `visible artwork must occupy the centered 96x96 area, got ${formatBounds(bounds)}`,
);
assert(
  cornersAreTransparent(logo),
  "logo canvas corners must remain transparent",
);

console.log("Validated 128x128 logo with centered 96x96 artwork.");

function visibleBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (alphaAt(image, x, y) === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return right === -1 ? null : { left, top, right, bottom };
}

function cornersAreTransparent(image) {
  return [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ].every(([x, y]) => alphaAt(image, x, y) === 0);
}

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

function formatBounds(bounds) {
  return `${bounds.left},${bounds.top} to ${bounds.right},${bounds.bottom}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
