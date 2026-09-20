import { expect } from '@playwright/test';
import { test } from './fixtures/fixtures';

test.describe('Annotations', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();
  });

  test('places annotations, saves, reopens, and verifies persistence', async ({
    appPage,
    page,
  }) => {
    // --- Place a fingering annotation ---
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await appPage.clickOnPage(0.3, 0.3);

    // --- Place a string annotation ---
    await page.getByRole('button', { name: /^String/ }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    await appPage.clickOnPage(0.4, 0.3);

    // --- Place a position annotation ---
    await page.getByRole('button', { name: /^Position/ }).click();
    await appPage.clickOnPage(0.5, 0.3);
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
    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('annotations-before-reopen.png');
    }

    // Close and reopen the saved file
    await appPage.closeDocument();
    await appPage.loadPDFFromPath(savedPath);
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();

    // Assert annotations were restored
    const restoredCount = await appPage.getAnnotationCount();
    expect(restoredCount).toBe(4);

    await appPage.screenshot('annotations-after-reopen');

    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('annotations-after-reopen.png');
    }
  });
});

test.describe('Annotation placement precision', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();
  });

  test('places annotations at the exact cursor position', async ({
    appPage,
    page,
  }) => {
    await page.getByRole('button', { name: 'Fingering' }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();

    // Capture each click's offset from the overlay surface at event
    // time — the same measurement the placement code uses — so we
    // compare against the actual event, not a stale bounding box.
    await page.evaluate(() => {
      const surface = document.querySelector('[class*="cursor-crosshair"]');
      const log: { offsetX: number; offsetY: number }[] = [];
      window.__clickOffsets = log;
      surface?.addEventListener('pointerup', (e) => {
        const sr = (e.currentTarget as Element).getBoundingClientRect();
        log.push({
          offsetX: (e as PointerEvent).clientX - sr.x,
          offsetY: (e as PointerEvent).clientY - sr.y,
        });
      });
    });

    await appPage.clickOnPage(0.25, 0.25);
    await appPage.clickOnPage(0.5, 0.5);
    await appPage.clickOnPage(0.75, 0.4);

    expect(await appPage.getAnnotationCount()).toBe(3);

    const results = await page.evaluate(() => {
      const offsets = window.__clickOffsets as {
        offsetX: number;
        offsetY: number;
      }[];
      const surface = document.querySelector(
        '[class*="cursor-crosshair"]',
      ) as HTMLElement;
      const buttons = surface.querySelectorAll<HTMLElement>(
        'button[title*="Tap to select"]',
      );

      return Array.from(buttons).map((btn, i) => {
        const anchor = btn.parentElement as HTMLElement;
        return {
          left: Number.parseFloat(anchor.style.left),
          top: Number.parseFloat(anchor.style.top),
          clickOffsetX: offsets[i].offsetX,
          clickOffsetY: offsets[i].offsetY,
        };
      });
    });

    expect(results).toHaveLength(3);

    for (const { left, top, clickOffsetX, clickOffsetY } of results) {
      expect(Math.abs(left - clickOffsetX)).toBeLessThan(2);
      expect(Math.abs(top - clickOffsetY)).toBeLessThan(2);
    }

    if (test.info().project.name === 'visual') {
      await expect(page).toHaveScreenshot('annotation-placement-precision.png');
    }
  });
});

test.describe('Annotation clipboard and undo/redo', () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setup();
    await appPage.open();
    await appPage.loadTestPDF();
    await appPage.waitForCanvas();
    await appPage.waitForAnalysis();
    await appPage.expandAnnotations();
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

declare global {
  interface Window {
    __clickOffsets: {
      offsetX: number;
      offsetY: number;
    }[];
  }
}
