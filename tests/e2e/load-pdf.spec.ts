import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.resolve(__dirname, 'fixtures/fixture.pdf');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      value: undefined,
      configurable: true,
    });
  });
});

test('loads a PDF and displays the viewer', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByText('Drop a PDF here')).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles(FIXTURE_PDF);

  const header = page.locator('header');
  await expect(header.locator('h1')).toContainText('fixture.pdf');
  await expect(header).toContainText('6 pages');

  await expect(page.locator('nav[aria-label="Pages"]')).toBeVisible();

  await expect(page.getByText('Rotate all left')).toBeVisible();
  await expect(page.getByText('Close')).toBeVisible();

  // Wait until pdfjs finishes painting the main viewer canvas (not a thumbnail).
  // The main Page uses className="isolate"; thumbnails live in the nav strip.
  const mainCanvas = page.locator('.isolate .react-pdf__Page__canvas');
  await expect(mainCanvas).toBeVisible();

  // Poll until the canvas content stops changing, which means pdfjs has
  // finished its render pass. A single pixel check can pass too early
  // because pdfjs paints progressively.
  await mainCanvas.evaluate((canvas: HTMLCanvasElement) => {
    return new Promise<void>((resolve, reject) => {
      let prevSnapshot = '';
      let stableCount = 0;

      function check() {
        try {
          const snapshot = canvas.toDataURL('image/png');
          if (snapshot === prevSnapshot) {
            stableCount++;
            if (stableCount >= 3) {
              resolve();
              return;
            }
          } else {
            stableCount = 0;
            prevSnapshot = snapshot;
          }
          requestAnimationFrame(check);
        } catch {
          reject(new Error('Canvas is tainted or inaccessible'));
        }
      }

      requestAnimationFrame(check);
    });
  });
});
