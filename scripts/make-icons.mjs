// Renders the app icons with the pre-installed Chromium. Run: node scripts/make-icons.mjs
import { chromium } from "playwright";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0f5fa8"/>
  <rect x="39" y="18" width="22" height="40" rx="11" fill="#fff"/>
  <path d="M28 46a22 22 0 0 0 44 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
  <path d="M50 68v12M38 82h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch();
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `public/icons/${name}.png` });
  await page.close();
}
await browser.close();
