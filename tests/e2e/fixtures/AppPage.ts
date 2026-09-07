import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.resolve(__dirname, 'fixture.pdf');

export class AppPage {
  constructor(public readonly page: Page) {}

  async setup() {
    await this.page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        value: undefined,
        configurable: true,
      });
    });
  }

  async open() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.getByText('Drop a PDF here')).toBeVisible();
  }

  async loadTestPDF() {
    const fileInput = this.page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles(FIXTURE_PDF);
  }

  async waitForCanvas() {
    const mainCanvas = this.page.locator('.isolate .react-pdf__Page__canvas');
    await expect(mainCanvas).toBeVisible();

    // Poll until the canvas content stops changing, which means pdfjs has
    // finished its render pass.
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
  }
}
