import { test as base } from '@playwright/test';
import { AppPage } from '#tests/e2e/fixtures/AppPage';

export const test = base.extend<{ appPage: AppPage }>({
  appPage: async ({ page }, use) => {
    const appPage = new AppPage(page);
    await use(appPage);
  },
});
