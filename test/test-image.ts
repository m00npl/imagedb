import { createCanvas } from 'canvas';

export function createTestPNG(sizeMB: number): Buffer {
  const bytesPerPixel = 4; // RGBA
  const totalBytes = sizeMB * 1024 * 1024;
  const totalPixels = Math.floor(totalBytes / bytesPerPixel);
  const sideLength = Math.floor(Math.sqrt(totalPixels));

  const canvas = createCanvas(sideLength, sideLength);
  const ctx = canvas.getContext('2d');

  for (let x = 0; x < sideLength; x += 10) {
    for (let y = 0; y < sideLength; y += 10) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 10, 10);
    }
  }

  return canvas.toBuffer('image/png');
}

export function createSimpleTestPNG(): Buffer {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FF0000';
  ctx.fillRect(0, 0, 50, 50);
  ctx.fillStyle = '#00FF00';
  ctx.fillRect(50, 0, 50, 50);
  ctx.fillStyle = '#0000FF';
  ctx.fillRect(0, 50, 50, 50);
  ctx.fillStyle = '#FFFF00';
  ctx.fillRect(50, 50, 50, 50);

  return canvas.toBuffer('image/png');
}