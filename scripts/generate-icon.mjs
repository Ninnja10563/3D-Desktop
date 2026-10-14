import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Rasterize the repository's vector mark locally. No external assets or requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'assets');
const svg = await readFile(path.join(root, 'public', '3d-desktop.svg'), 'utf8');
const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const chunks = [];
  // PNG icon entries are supported by modern macOS. Each size is drawn from SVG.
  for (const [kind, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = await page.evaluate(async ({ source, size }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const inset = Math.round(size * 0.08);
      context.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, size });
    const data = Buffer.from(png, 'base64');
    const header = Buffer.alloc(8);
    header.write(kind, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    chunks.push(header, data);
    if (size === 1024) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, '3D-Desktop.png'), data);
    }
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  await writeFile(path.join(directory, '3D-Desktop.icns'), Buffer.concat([header, body]));
  console.log('Generated assets/3D-Desktop.icns and assets/3D-Desktop.png from public/3d-desktop.svg.');
} finally {
  await browser.close();
}
