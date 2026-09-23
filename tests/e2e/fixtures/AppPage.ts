import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Download, expect, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.resolve(__dirname, 'fixture.pdf');
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots');
const DOWNLOADS_DIR = path.resolve(__dirname, '..', 'downloads');

export class AppPage {
  private generatedFiles: string[] = [];

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

  async loadPDFFromPath(filePath: string) {
    const fileInput = this.page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles(filePath);
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

  async expandSection(testId: string) {
    const section = this.page.getByTestId(testId);
    await expect(section).toBeVisible({ timeout: 15_000 });
    const toggle = section.getByRole('button', { expanded: false });
    if ((await toggle.count()) > 0) {
      await toggle.click();
    }
  }

  async waitForAnalysis() {
    await this.expandSection('DetectedInstruments');
    await expect(
      this.page.getByText(/\d+ staves · \d+ sections detected/),
    ).toBeVisible({ timeout: 15_000 });
  }

  async expandAnnotations() {
    await this.expandSection('AddAnnotations');
  }

  async expandRegions() {
    await this.expandSection('EditRegionsSection');
  }

  async deselectAllParts() {
    const button = this.page.getByRole('button', { name: 'Deselect all' });
    if (await button.isVisible()) {
      await button.click();
    }
  }

  async togglePart(staffNumber: number) {
    const nameInput = this.page.getByLabel(`Name for staff ${staffNumber}`);
    const li = nameInput.locator('..');
    const checkbox = li.locator('input[type="checkbox"]');
    await checkbox.click();
  }

  async selectPartByName(name: string) {
    const li = this.page
      .locator('li')
      .filter({ has: this.page.locator(`input[value="${name}"]`) });
    const checkbox = li.locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
  }

  async renamePart(staffNumber: number, name: string) {
    const nameInput = this.page.getByLabel(`Name for staff ${staffNumber}`);
    await nameInput.fill(name);
  }

  async ensureMarkingsChecked() {
    const checkbox = this.page
      .locator('label')
      .filter({ hasText: 'Keep measure numbers & tempo marks' })
      .locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked())) {
      await checkbox.click();
    }
  }

  async getMarkingCounts(): Promise<{
    measure: number;
    tempo: number;
    timeSignature: number;
  }> {
    const text = await this.page
      .locator('label')
      .filter({ hasText: 'Keep measure numbers & tempo marks' })
      .innerText();
    const measureMatch = text.match(/(\d+) measure/);
    const tempoMatch = text.match(/(\d+) tempo/);
    const timeSigMatch = text.match(/(\d+) time/);
    return {
      measure: measureMatch ? Number(measureMatch[1]) : 0,
      tempo: tempoMatch ? Number(tempoMatch[1]) : 0,
      timeSignature: timeSigMatch ? Number(timeSigMatch[1]) : 0,
    };
  }

  async extractRegions(): Promise<Download> {
    const extractButton = this.page.getByRole('button', {
      name: /^Extract \d+ regions?$/,
    });
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      extractButton.click(),
    ]);
    return download;
  }

  async saveDownload(download: Download): Promise<string> {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const filePath = path.join(DOWNLOADS_DIR, download.suggestedFilename());
    await download.saveAs(filePath);
    this.generatedFiles.push(filePath);
    return filePath;
  }

  async saveCopy(name: string): Promise<Download> {
    await this.page
      .getByRole('button', { name: 'Save a copy', exact: true })
      .click();

    const nameInput = this.page.locator('#save-copy-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);

    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page
        .locator('form:has(#save-copy-name)')
        .getByRole('button', { name: 'Save' })
        .click(),
    ]);
    return download;
  }

  async exportMarkings(
    map: 'time signature' | 'tempo',
    name: string,
  ): Promise<Download> {
    await this.page.getByRole('button', { name: `Export ${map} map` }).click();

    const nameInput = this.page.locator('#export-markings-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);

    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page
        .locator('form:has(#export-markings-name)')
        .getByRole('button', { name: 'Save' })
        .click(),
    ]);
    return download;
  }

  async closeDocument() {
    await this.page.getByRole('button', { name: 'Close' }).click();
    await expect(this.page.getByText('Drop a PDF here')).toBeVisible();
  }

  async clickOnPage(xRatio: number, yRatio: number) {
    const canvas = this.page.locator('.isolate .react-pdf__Page__canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not visible');
    await this.page.mouse.click(
      box.x + box.width * xRatio,
      box.y + box.height * yRatio,
    );
  }

  async screenshot(name: string): Promise<string> {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await this.page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async getAnnotationCount(): Promise<number> {
    await this.expandSection('AddAnnotations');
    const text = await this.page
      .locator('section')
      .filter({ hasText: /\d+ placed/ })
      .innerText();
    const match = text.match(/(\d+) placed/);
    return match ? Number(match[1]) : 0;
  }

  cleanup() {
    for (const file of this.generatedFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // File may already be deleted or never created
      }
    }
    this.generatedFiles = [];

    // Clean up the downloads directory if empty
    try {
      const remaining = fs.readdirSync(DOWNLOADS_DIR);
      if (remaining.length === 0) {
        fs.rmdirSync(DOWNLOADS_DIR);
      }
    } catch {
      // Directory may not exist
    }
  }
}
