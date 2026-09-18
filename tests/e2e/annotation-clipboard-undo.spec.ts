import { expect } from '@playwright/test';
import { test } from '#tests/e2e/fixtures/fixtures';

test.describe('Annotation clipboard and undo/redo', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
  });

  test('undo and redo annotation placement via toolbar buttons', async ({
    appPage,
    page,
  }) => {
    // Place a fingering
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    expect(await appPage.getAnnotationCount()).toBe(1);

    // Place a second fingering
    await appPage.clickOnPage(0.4, 0.3);

    expect(await appPage.getAnnotationCount()).toBe(2);

    // Undo mark button should be enabled; click it
    const undoMark = page.getByRole('button', { name: 'Undo mark' });
    await expect(undoMark).toBeEnabled();
    await undoMark.click();

    expect(await appPage.getAnnotationCount()).toBe(1);

    // Redo mark button should be enabled; click it
    const redoMark = page.getByRole('button', { name: 'Redo mark' });
    await expect(redoMark).toBeEnabled();
    await redoMark.click();

    expect(await appPage.getAnnotationCount()).toBe(2);
  });

  test('undo and redo via keyboard shortcuts', async ({ appPage, page }) => {
    // Place a fingering
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.4);

    expect(await appPage.getAnnotationCount()).toBe(1);

    // Dismiss the tool so keyboard shortcuts hit the annotation hook
    await page.getByRole('button', { name: 'Fingering' }).click();

    // Undo with Cmd+Z
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);

    expect(await appPage.getAnnotationCount()).toBe(0);

    // Redo with Cmd+Shift+Z
    await page.keyboard.press(`${mod}+Shift+z`);

    expect(await appPage.getAnnotationCount()).toBe(1);
  });

  test('copy and paste an annotation', async ({ appPage, page }) => {
    // Place a fingering annotation (uses a value that won't collide with menu buttons)
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '4', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    expect(await appPage.getAnnotationCount()).toBe(1);

    // Dismiss the tool before selecting
    await page.getByRole('button', { name: 'Fingering' }).click();

    // Tap the annotation to select it. Annotation buttons carry a
    // distinctive title; locate by it to avoid collisions with menu buttons.
    const unselected = page.locator('button[title*="Tap to select"]');
    await unselected.click();

    // After the click the title changes to the selected variant. Wait for
    // the ring class on the now-selected button so we know React has
    // re-rendered and the keyboard hook has the updated selectedId.
    const selected = page.locator('button[title*="Cmd/Ctrl+C to copy"]');
    await expect(selected).toHaveClass(/ring-2/);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Copy
    await page.keyboard.press(`${mod}+c`);

    // Move the pointer over the score surface so the paste hook knows
    // which page and PDF coordinates to use.
    const canvas = page.locator('.isolate .react-pdf__Page__canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not visible');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

    // Paste
    await page.keyboard.press(`${mod}+v`);

    expect(await appPage.getAnnotationCount()).toBe(2);

    // Undo the paste
    await page.keyboard.press(`${mod}+z`);

    expect(await appPage.getAnnotationCount()).toBe(1);
  });

  test('undo mark button is disabled when nothing to undo', async ({
    page,
  }) => {
    const undoMark = page.getByRole('button', { name: 'Undo mark' });
    const redoMark = page.getByRole('button', { name: 'Redo mark' });

    await expect(undoMark).toBeDisabled();
    await expect(redoMark).toBeDisabled();
  });

  test('undo stack caps at 3 entries', async ({ appPage, page }) => {
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();

    // Place 4 annotations
    await appPage.clickOnPage(0.2, 0.3);
    await appPage.clickOnPage(0.3, 0.3);
    await appPage.clickOnPage(0.4, 0.3);
    await appPage.clickOnPage(0.5, 0.3);

    expect(await appPage.getAnnotationCount()).toBe(4);

    // Undo 3 times — the cap
    const undoMark = page.getByRole('button', { name: 'Undo mark' });
    await undoMark.click();
    await undoMark.click();
    await undoMark.click();

    expect(await appPage.getAnnotationCount()).toBe(1);

    // Fourth undo should be disabled — stack was capped at 3
    await expect(undoMark).toBeDisabled();
  });
});
