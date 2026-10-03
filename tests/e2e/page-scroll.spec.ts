import { expect } from '@playwright/test';
import { test } from './fixtures/fixtures';

const PAGE_GAP = 16;

/** A page scrolled to sits one gap below the top of the view, give or take a subpixel. */
function expectAtTop(offset: number) {
  expect(Math.abs(offset - PAGE_GAP)).toBeLessThanOrEqual(1);
}

test.describe('Continuous page scroll', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
  });

  test('scrolling the view selects the page in view', async ({
    appPage,
    page,
  }) => {
    await expect(appPage.currentThumbnail()).toHaveText('Page 1');

    const stage = await appPage.stage().boundingBox();
    const first = await appPage.viewerPage(0).boundingBox();
    if (!stage || !first) {
      throw new Error('Viewer not visible');
    }

    await page.mouse.move(
      stage.x + stage.width / 2,
      stage.y + stage.height / 2,
    );
    await page.mouse.wheel(0, 2 * (first.height + PAGE_GAP));

    await expect(appPage.currentThumbnail()).toHaveText('Page 3');
    await expect(appPage.viewerPage(2)).toBeInViewport();

    await appPage.waitForCanvas();
    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('page-scroll-continuous.png');
    }
  });

  test('clicking a thumbnail scrolls its page to the top', async ({
    appPage,
    page,
  }) => {
    const strip = page.getByRole('navigation', { name: 'Pages' });
    await strip.getByRole('button', { name: 'Page 6', exact: true }).click();

    await expect(appPage.viewerPage(5)).toBeInViewport();
    expectAtTop(await appPage.pageOffsetInStage(5));

    // The scroll the click caused must not select a different page.
    await page.waitForTimeout(300);
    await expect(appPage.currentThumbnail()).toHaveText('Page 6');
  });

  test('an annotation stays on its page across scrolling', async ({
    appPage,
    page,
  }) => {
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();

    await appPage.scrollToPage(1);
    await expect(appPage.currentThumbnail()).toHaveText('Page 2');

    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    const marks = page.locator('button[title*="Drag to move"]');
    await expect(appPage.viewerPage(1).locator(marks)).toHaveCount(1);

    await appPage.scrollToPage(3);
    await expect(appPage.currentThumbnail()).toHaveText('Page 4');
    await expect(appPage.viewerPage(3).locator(marks)).toHaveCount(0);

    await appPage.scrollToPage(1);
    await expect(appPage.currentThumbnail()).toHaveText('Page 2');
    await expect(appPage.viewerPage(1).locator(marks)).toHaveCount(1);
    await expect(marks).toHaveCount(1);
  });

  test('a note being typed survives scrolling its page out of view', async ({
    appPage,
    page,
  }) => {
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();

    await page.getByRole('button', { name: 'Performance' }).click();
    await appPage.clickOnPage(0.5, 0.3);
    const draft = page.locator('input[placeholder*="Performance"]');
    await draft.fill('legato');

    await appPage.scrollToPage(5);
    await expect(appPage.currentThumbnail()).toHaveText('Page 6');
    // Page 2 is past the overscan and gone; page 1 is held by the edit.
    await expect(appPage.viewerPage(1)).toHaveCount(0);
    await expect(appPage.viewerPage(0)).toHaveCount(1);

    await appPage.scrollToPage(0);
    await expect(draft).toHaveValue('legato');
    await draft.press('Enter');

    await expect(
      appPage.viewerPage(0).getByRole('button', { name: 'legato' }),
    ).toBeVisible();
  });

  test('deleting the selected page lands the view on the next one', async ({
    appPage,
    page,
  }) => {
    const strip = page.getByRole('navigation', { name: 'Pages' });
    await strip.getByRole('button', { name: 'Page 3', exact: true }).click();
    await expect(appPage.currentThumbnail()).toHaveText('Page 3');

    await strip.getByRole('button', { name: 'Delete page 3' }).click();

    await expect(page.locator('header')).toContainText('5 pages');
    await expect(appPage.currentThumbnail()).toHaveText('Page 3');
    // What was page 4 of the source now holds the third place.
    await expect(appPage.viewerPage(2)).toHaveAttribute(
      'data-source-index',
      '3',
    );
    await expect(appPage.viewerPage(2)).toBeInViewport();
    expectAtTop(await appPage.pageOffsetInStage(2));
  });
});
