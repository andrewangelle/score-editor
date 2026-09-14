import { expect } from '@playwright/test';
import { test } from './fixtures/fixtures';

test.describe('Annotations', () => {
  test('places annotations, saves, reopens, and verifies persistence', async ({
    appPage,
    page,
  }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();

    // --- Place a fingering annotation ---
    await page.getByRole('button', { name: 'Fingering' }).click();
    // Pick value "1" from the value menu
    await page.getByRole('button', { name: '1', exact: true }).click();
    // Click on the page to place the annotation
    await appPage.clickOnPage(0.3, 0.3);

    // --- Place a string annotation ---
    await page.getByRole('button', { name: /^String/ }).click();
    // Pick value "3" from the value menu
    await page.getByRole('button', { name: '3', exact: true }).click();
    await appPage.clickOnPage(0.4, 0.3);

    // --- Place a position annotation ---
    await page.getByRole('button', { name: /^Position/ }).click();
    // Position has no value menu — clicking places an empty mark with an editor
    await appPage.clickOnPage(0.5, 0.3);
    // Type a position value and commit
    const positionInput = page.locator('input[placeholder*="Position"]');
    await positionInput.fill('5');
    await positionInput.press('Enter');

    // --- Place a performance annotation ---
    await page.getByRole('button', { name: 'Performance' }).click();
    await appPage.clickOnPage(0.6, 0.3);
    const noteInput = page.locator('input[placeholder*="Performance"]');
    await noteInput.fill('legato');
    await noteInput.press('Enter');

    // Verify 4 annotations are placed
    const count = await appPage.getAnnotationCount();
    expect(count).toBe(4);

    // Save a copy with annotations
    const download = await appPage.saveCopy('fixture-annotated');
    const savedPath = await appPage.saveDownload(download);

    await appPage.screenshot('annotations-before-reopen');
    await expect(page).toHaveScreenshot('annotations-before-reopen.png');

    // Close and reopen the saved file
    await appPage.closeDocument();
    await appPage.loadPDFFromPath(savedPath);
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();

    // Assert annotations were restored
    const restoredCount = await appPage.getAnnotationCount();
    expect(restoredCount).toBe(4);

    await appPage.screenshot('annotations-after-reopen');
    await expect(page).toHaveScreenshot('annotations-after-reopen.png');
  });
});
