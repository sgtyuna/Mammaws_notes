// Shared helpers: serve the app folder on localhost and drive it in Google Chrome.
import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let fails = 0, passes = 0;
export function ok(cond, msg) { if (cond) { passes++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } }
export function eq(got, want, msg) { ok(JSON.stringify(got) === JSON.stringify(want), `${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
export const wait = (pg, ms) => pg.waitForTimeout(ms);

export function serve() {
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    if (!file.startsWith(ROOT) || file.includes(`${path.sep}tests${path.sep}`)) { res.writeHead(404); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

export async function launch() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  return browser;
}

// A fresh browser profile = a fresh, empty copy of the app, like a new phone.
export async function freshPage(browser, url, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, hasTouch: false });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(url);
  await pg.waitForSelector('#app > *');
  return { ctx, pg, errors };
}

export function report() {
  console.log(`\n  ${passes} passed, ${fails} failed`);
  return fails;
}
