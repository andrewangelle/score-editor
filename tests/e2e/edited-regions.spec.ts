import { expect } from '@playwright/test';
import { test } from '#tests/e2e/fixtures/fixtures';

test.describe('Edited regions', () => {
  test('resizes a region, saves, reopens, and verifies the edit persisted', async ({
    appPage,
    page,
  }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();

    // Select only the first part so regions are manageable
    await appPage.deselectAllParts();
    await appPage.togglePart(1);

    // Enter region editing mode and screenshot the original detected regions
    await page.getByRole('button', { name: 'Edit regions' }).click();
    await expect(page.getByLabel(/^Drag bottom edge of/).first()).toBeVisible();
    await appPage.screenshot('edited-regions-before');
    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('edited-regions-before.png');
    }

    // Find the first region's bottom edge handle and drag it to resize
    const bottomHandle = page.getByLabel(/^Drag bottom edge of/).first();
    const handleBox = await bottomHandle.boundingBox();
    if (!handleBox) throw new Error('Bottom edge handle not visible');

    // Drag the bottom edge down by 80 pixels for a clearly visible resize
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2 + 80,
      { steps: 5 },
    );
    await page.mouse.up();

    // Exit region editing mode
    await page.getByRole('button', { name: 'Done editing' }).click();

    // The regions panel now says the regions are manual
    await expect(
      page.getByRole('button', { name: 'Reset to detected staves' }),
    ).toBeEnabled();

    // Save a copy — this embeds the editor state including the manual regions
    const download = await appPage.saveCopy('fixture-edited-regions');
    const savedPath = await appPage.saveDownload(download);

    // Close and reopen the saved file
    await appPage.closeDocument();
    await appPage.loadPDFFromPath(savedPath);
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();

    // The reset button is enabled only when regions are manual (edited)
    await expect(
      page.getByRole('button', { name: 'Reset to detected staves' }),
    ).toBeEnabled();

    // Enter edit mode so the restored regions are visible with handles
    await page.getByRole('button', { name: 'Edit regions' }).click();
    await expect(page.getByLabel(/^Drag bottom edge of/).first()).toBeVisible();

    await appPage.screenshot('edited-regions-after');
    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('edited-regions-after.png');
    }
  });
});
