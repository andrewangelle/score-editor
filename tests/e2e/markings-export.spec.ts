import fs from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './fixtures/fixtures';

test.describe('Markings export', () => {
  for (const map of ['time signature', 'tempo'] as const) {
    test(`exports the ${map} map to a named PDF`, async ({ appPage }) => {
      await appPage.setup();
      await appPage.open();
      await appPage.loadTestPDF();
      await appPage.waitForCanvas();
      await appPage.waitForAnalysis();

      const download = await appPage.exportMarkings(map, 'test-markings.pdf');

      expect(download.suggestedFilename()).toBe('test-markings.pdf');

      const filePath = await appPage.saveDownload(download);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);

      const header = Buffer.alloc(4);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, header, 0, 4, 0);
      fs.closeSync(fd);
      expect(header.toString('ascii')).toBe('%PDF');
    });
  }
});
