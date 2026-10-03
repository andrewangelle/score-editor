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

    await expect(page.getByText('Close')).toBeVisible();

    await appPage.waitForCanvas();
  });

  // Analysis takes the pages in view first, so a page scrolled to straight
  // away gets its overlay without waiting on the pages before it. On a small
  // fixture this holds either way; it guards the wiring.
  test('analyses a page scrolled to straight away', async () => {
    const last = 5;
    await expect(appPage.viewerPage(0)).toBeVisible();
    await appPage.scrollToPage(last);

    await expect(appPage.viewerPage(last)).toBeInViewport();
    await expect(
      appPage.viewerPage(last).getByTestId('ScoreOverlay'),
    ).toBeVisible();
  });
});
