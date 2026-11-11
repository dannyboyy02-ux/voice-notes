// Renders the app icons with the pre-installed Chromium. Run: node scripts/make-icons.mjs
import { chromium } from "playwright";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4a4d52"/>
      <stop offset="0.55" stop-color="#1f2124"/>
      <stop offset="1" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#bg)"/>
  <path d="M59 16 L29 54 H47 L41 84 L71 45 H53 Z" fill="#ffffff" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>
</svg>`;

const browser = await chromium.launch();
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `public/icons/${name}.png` });
  await page.close();
}
await browser.close();
