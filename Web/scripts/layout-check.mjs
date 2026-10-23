import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const baseUrl = process.env.AGRI_WEB_URL || 'http://127.0.0.1:5173';
const qaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/qa');
const cases = [
  ['desktop', 1440, 900],
  ['tablet', 1100, 900],
  ['small', 800, 900],
  ['mobile', 390, 844]
];

const intersects = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
const browser = await chromium.launch({ headless: true });
await fs.mkdir(qaDir, { recursive: true });
const failures = [];

for (const [name, width, height] of cases) {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
    await page.route('**/api/categories', (route) => route.fulfill({
      json: { categories: ['vegetables', 'cereals', 'fruits'] }
    }));
    await page.route('**/api/products*', (route) => route.fulfill({
      json: {
        products: Array.from({ length: 4 }, (_, index) => ({
          id: `layout-product-${index}`,
          title: `Fresh seasonal produce ${index + 1}`,
          category: 'vegetables',
          pricePerUnit: 1250 + index,
          unit: 'kg',
          location: { county: 'Kiambu' },
          thumbUrl: '',
          ratingAvg: 4.8,
          ratingCount: 3
        })),
        nextCursor: null,
        hasMore: false
      }
    }));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('.site-header').waitFor({ state: 'visible', timeout: 10000 });
    const result = await page.evaluate(() => {
      const children = [...document.querySelectorAll('.product-grid > *')].map((element) => element.getBoundingClientRect().toJSON());
      const widthOverflow = [...document.querySelectorAll('*')].some((element) => element.getBoundingClientRect().right > window.innerWidth + 1);
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      const interactive = [...document.querySelectorAll('button, a, input, [tabindex]')].filter((element) => element.offsetParent !== null).at(-1)?.getBoundingClientRect();
      const fixedElements = [...document.querySelectorAll('*')].filter((element) => getComputedStyle(element).position === 'fixed').map((element) => element.getBoundingClientRect());
      return {
        columns: children,
        overlap: children.some((box, index) => children.slice(index + 1).some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)),
        widthOverflow,
        scrollWidth: document.scrollingElement.scrollWidth,
        lastCovered: Boolean(interactive && fixedElements.some((fixed) => fixed.left < interactive.right && fixed.right > interactive.left && fixed.top < interactive.bottom && fixed.bottom > interactive.top))
      };
    });
    if (result.overlap || result.widthOverflow || result.scrollWidth > width || result.lastCovered) failures.push({ name, colorScheme, result });
    await page.screenshot({ path: path.join(qaDir, `home-${name}-${colorScheme}.png`), fullPage: true });
    await page.close();
  }
}

await browser.close();
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log('Layout checks passed for 390, 800, 1100, and 1440px in light and dark modes.');
}
