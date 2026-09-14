import { expect, test } from '@playwright/test';
import { AppPage } from './fixtures/AppPage';

test.describe('Visual regression', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    appPage.setup();
    await appPage.open();
  });

  test('landing page', async ({ page }) => {
    await expect(page).toHaveScreenshot('landing.png');
  });

  test('pdf viewer after load', async ({ page }) => {
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await expect(page).toHaveScreenshot('pdf-viewer.png');
  });
});
