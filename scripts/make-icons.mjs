// Renders the app icons with the pre-installed Chromium. Run: node scripts/make-icons.mjs
import { chromium } from "playwright";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0f5fa8"/>
  <path d="M57 12 L27 55 H46 L41 88 L73 43 H53 Z" fill="#ffd54a" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
</svg>`;

const browser = await chromium.launch();
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `public/icons/${name}.png` });
  await page.close();
}
await browser.close();
