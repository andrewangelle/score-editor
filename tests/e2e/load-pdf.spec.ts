import { expect, test } from '@playwright/test';
import { AppPage } from './fixtures/AppPage';

test.describe('App smoke test', () => {
  let appPage: AppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new AppPage(page);
    appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
  });

  test('loads a PDF and displays the viewer', async ({ page }) => {
    const header = appPage.page.locator('header');
    await expect(header.locator('h1')).toContainText('fixture.pdf');
    await expect(header).toContainText('6 pages');

    await expect(page.locator('nav[aria-label="Pages"]')).toBeVisible();

    await expect(page.getByText('Rotate all left')).toBeVisible();
    await expect(page.getByText('Close')).toBeVisible();

    await appPage.waitForCanvas();
  });
});
