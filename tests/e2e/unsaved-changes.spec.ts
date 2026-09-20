import { expect } from '@playwright/test';
import { test } from '#tests/e2e/fixtures/fixtures';

test.describe('Unsaved changes indicator and save button', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
  });

  test('save button is disabled on a freshly opened document', async ({
    page,
  }) => {
    const saveButton = page.getByRole('button', { name: 'Save a copy' });
    await expect(saveButton).toBeVisible();

    const header = page.locator('header');
    await expect(header).not.toContainText('unsaved changes');

    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('unsaved-clean-open.png');
    }
  });

  test('save button enables after placing an annotation', async ({
    appPage,
    page,
  }) => {
    const header = page.locator('header');
    await expect(header).not.toContainText('unsaved changes');

    await appPage.expandAnnotations();
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    await expect(header).toContainText('unsaved changes');

    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('unsaved-after-annotation.png');
    }
  });

  test('unsaved indicator clears after undoing the only annotation', async ({
    appPage,
    page,
  }) => {
    const header = page.locator('header');

    await appPage.expandAnnotations();
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    await expect(header).toContainText('unsaved changes');

    // Undo the annotation placement — returns to original, so no longer unsaved
    const undoMark = page.getByRole('button', { name: 'Undo mark' });
    await undoMark.click();

    expect(await appPage.getAnnotationCount()).toBe(0);
    await expect(header).not.toContainText('unsaved changes');

    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('unsaved-after-undo.png');
    }
  });
});
