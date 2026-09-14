import { expect } from '@playwright/test';
import { test } from './fixtures/fixtures';

test.describe('Part extraction', () => {
  test('extracts Electric Guitar 1 and 2 with measure numbers and tempo marks', async ({
    appPage,
    page,
  }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();

    // Deselect all, then select the actual Electric Guitar parts by name
    await appPage.deselectAllParts();
    await appPage.selectPartByName('Electric Guitar 1');
    await appPage.selectPartByName('Electric Guitar 2');

    // Ensure measure numbers and tempo marks are retained
    await appPage.ensureMarkingsChecked();
    const markings = await appPage.getMarkingCounts();
    expect(markings.measure).toBeGreaterThan(0);

    // Extract the selected parts
    const download = await appPage.extractRegions();
    const fileName = download.suggestedFilename();

    expect(fileName).toContain('Electric Guitar 1');
    expect(fileName).toContain('Electric Guitar 2');
    expect(fileName).toMatch(/\.pdf$/);

    // Save the extracted PDF
    const filePath = await appPage.saveDownload(download);
    const { statSync } = await import('node:fs');
    const stat = statSync(filePath);
    expect(stat.size).toBeGreaterThan(0);

    // Open the extracted file so the screenshot shows the output
    await appPage.closeDocument();
    await appPage.loadPDFFromPath(filePath);
    await appPage.waitForCanvas();

    await appPage.screenshot('part-extraction');
    await expect(page).toHaveScreenshot('part-extraction.png');
  });
});
