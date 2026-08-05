import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const outputSize = 128;
const artworkSize = 96;
const scale = 4;
const source = new PNG({
  width: artworkSize * scale,
  height: artworkSize * scale,
});

paintLogo(source);
const artwork = downsample(source, artworkSize);
const logo = centerArtwork(artwork, outputSize);
await writeFile(
  new URL("../public/logo.png", import.meta.url),
  PNG.sync.write(logo),
);

function centerArtwork(artworkImage, canvasSize) {
  const canvas = new PNG({ width: canvasSize, height: canvasSize });
  const inset = (canvasSize - artworkImage.width) / 2;
  if (!Number.isInteger(inset) || artworkImage.width !== artworkImage.height) {
    throw new Error(
      "Logo artwork must be square and centered on whole pixels.",
    );
  }

  for (let y = 0; y < artworkImage.height; y += 1) {
    for (let x = 0; x < artworkImage.width; x += 1) {
      const sourceOffset = (y * artworkImage.width + x) * 4;
      const targetOffset = ((y + inset) * canvas.width + x + inset) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        canvas.data[targetOffset + channel] =
          artworkImage.data[sourceOffset + channel];
      }
    }
  }
  return canvas;
}

function paintLogo(image) {
  const { width: size } = image;
  const moss = [69, 99, 75, 255];
  const mossDark = [48, 63, 51, 255];
  const paper = [241, 240, 232, 255];
  const sage = [190, 198, 184, 255];
  const rust = [135, 81, 59, 255];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radius = size * 0.08;
      const inside = insideRoundedRect(x, y, 0, 0, size, size, radius);
      setPixel(image, x, y, inside ? moss : [0, 0, 0, 0]);
    }
  }

  drawRoundedOutline(image, 0.015, 0.015, 0.985, 0.985, 0.065, 0.045, paper);
  drawRoundedOutline(image, 0.16, 0.19, 0.68, 0.66, 0.035, 0.038, sage);
  fillRoundedRect(image, 0.3, 0.35, 0.85, 0.8, 0.035, paper);
  drawRoundedOutline(image, 0.3, 0.35, 0.85, 0.8, 0.035, 0.02, mossDark);
  fillCircle(image, 0.45, 0.58, 0.04, rust);
  drawStar(image, 0.66, 0.58, 0.105, mossDark);
}

function downsample(sourceImage, targetSize) {
  const target = new PNG({ width: targetSize, height: targetSize });
  const sampleSize = sourceImage.width / targetSize;
  const sampleCount = sampleSize * sampleSize;

  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      let alphaTotal = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      for (let offsetY = 0; offsetY < sampleSize; offsetY += 1) {
        for (let offsetX = 0; offsetX < sampleSize; offsetX += 1) {
          const sourceX = targetX * sampleSize + offsetX;
          const sourceY = targetY * sampleSize + offsetY;
          const sourceOffset = (sourceY * sourceImage.width + sourceX) * 4;
          const alpha = sourceImage.data[sourceOffset + 3];
          alphaTotal += alpha;
          redTotal += sourceImage.data[sourceOffset] * alpha;
          greenTotal += sourceImage.data[sourceOffset + 1] * alpha;
          blueTotal += sourceImage.data[sourceOffset + 2] * alpha;
        }
      }

      const targetOffset = (targetY * targetSize + targetX) * 4;
      target.data[targetOffset] = alphaTotal === 0 ? 0 : redTotal / alphaTotal;
      target.data[targetOffset + 1] =
        alphaTotal === 0 ? 0 : greenTotal / alphaTotal;
      target.data[targetOffset + 2] =
        alphaTotal === 0 ? 0 : blueTotal / alphaTotal;
      target.data[targetOffset + 3] = alphaTotal / sampleCount;
    }
  }
  return target;
}

function drawRoundedOutline(
  image,
  left,
  top,
  right,
  bottom,
  radius,
  thicknessRatio,
  color,
) {
  const size = image.width;
  const thickness = Math.max(1, Math.round(size * thicknessRatio));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const outer = insideRoundedRect(
        x,
        y,
        left * size,
        top * size,
        right * size,
        bottom * size,
        radius * size,
      );
      const inner = insideRoundedRect(
        x,
        y,
        left * size + thickness,
        top * size + thickness,
        right * size - thickness,
        bottom * size - thickness,
        Math.max(0, radius * size - thickness),
      );
      if (outer && !inner) setPixel(image, x, y, color);
    }
  }
}

function fillRoundedRect(image, left, top, right, bottom, radius, color) {
  const size = image.width;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (
        insideRoundedRect(
          x,
          y,
          left * size,
          top * size,
          right * size,
          bottom * size,
          radius * size,
        )
      ) {
        setPixel(image, x, y, color);
      }
    }
  }
}

function fillCircle(image, centerX, centerY, radius, color) {
  const size = image.width;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centerX * size;
      const dy = y + 0.5 - centerY * size;
      if (dx * dx + dy * dy <= (radius * size) ** 2) {
        setPixel(image, x, y, color);
      }
    }
  }
}

function drawStar(image, centerX, centerY, radius, color) {
  const size = image.width;
  const centerPixelX = centerX * size;
  const centerPixelY = centerY * size;
  const pixelRadius = radius * size;
  const thickness = Math.max(1, size * 0.035);
  const lines = [
    [
      centerPixelX,
      centerPixelY - pixelRadius,
      centerPixelX,
      centerPixelY + pixelRadius,
    ],
    [
      centerPixelX - pixelRadius,
      centerPixelY,
      centerPixelX + pixelRadius,
      centerPixelY,
    ],
    [
      centerPixelX - pixelRadius * 0.72,
      centerPixelY - pixelRadius * 0.72,
      centerPixelX + pixelRadius * 0.72,
      centerPixelY + pixelRadius * 0.72,
    ],
    [
      centerPixelX + pixelRadius * 0.72,
      centerPixelY - pixelRadius * 0.72,
      centerPixelX - pixelRadius * 0.72,
      centerPixelY + pixelRadius * 0.72,
    ],
  ];
  for (const [x1, y1, x2, y2] of lines) {
    drawLine(image, x1, y1, x2, y2, thickness, color);
  }
}

function drawLine(image, x1, y1, x2, y2, thickness, color) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = x1 + (x2 - x1) * ratio;
    const y = y1 + (y2 - y1) * ratio;
    for (
      let py = Math.floor(y - thickness);
      py <= Math.ceil(y + thickness);
      py += 1
    ) {
      for (
        let px = Math.floor(x - thickness);
        px <= Math.ceil(x + thickness);
        px += 1
      ) {
        if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= thickness) {
          setPixel(image, px, py, color);
        }
      }
    }
  }
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const pixelX = x + 0.5;
  const pixelY = y + 0.5;
  const nearestX = Math.max(left + radius, Math.min(pixelX, right - radius));
  const nearestY = Math.max(top + radius, Math.min(pixelY, bottom - radius));
  const deltaX = pixelX - nearestX;
  const deltaY = pixelY - nearestY;
  return (
    pixelX >= left &&
    pixelX <= right &&
    pixelY >= top &&
    pixelY <= bottom &&
    deltaX * deltaX + deltaY * deltaY <= radius * radius
  );
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = color[3];
}
