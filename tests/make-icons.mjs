// Draws the PNG app icons from icons/icon.svg. Run after changing the SVG: npm run icons
import { launch, ROOT } from './lib.mjs';
import { readFile } from 'fs/promises';
import path from 'path';

const svg = await readFile(path.join(ROOT, 'icons/icon.svg'), 'utf8');
const browser = await launch();
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const pg = await browser.newPage({ viewport: { width: size, height: size } });
  await pg.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await pg.screenshot({ path: path.join(ROOT, 'icons', name) });
  await pg.close();
}
await browser.close();
console.log('icons drawn');
