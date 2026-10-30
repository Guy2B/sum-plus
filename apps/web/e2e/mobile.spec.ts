import { test, expect } from '@playwright/test';
import { onboard, watchErrors } from './helpers';

test('mobile layout: bottom navigation, drawer, no horizontal overflow', async ({ page }) => {
  const errors = watchErrors(page);
  await onboard(page, { demo: true });
  const nav = page.getByRole('navigation', { name: 'Navigation rapide' });
  await expect(nav).toBeVisible();
  for (const route of ['today', 'attention', 'plan', 'coach', 'tasks', 'calendar', 'account']) {
    await page.goto(`/app.html#${route}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on #${route}`).toBeLessThanOrEqual(1);
  }
  await nav.getByRole('button', { name: 'Plus' }).click();
  await expect(page.locator('.sidebar.open')).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Bibliothèque' }).click();
  await page
    .locator('.sidebar')
    .getByRole('link', { name: /Journal/ })
    .click();
  await expect(page).toHaveURL(/#journal/);
  await expect(page.locator('.sidebar.open')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Cortex on mobile: bottom navigation, no horizontal overflow', async ({ page }) => {
  const errors = watchErrors(page);
  for (const view of ['today', 'planning', 'habits', 'notes', 'review', 'tasks']) {
    await page.goto(`/cortex.html#${view}`);
    await expect(page.locator('#main h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on Cortex #${view}`).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('.bottom-nav')).toBeVisible();
  expect(errors).toEqual([]);
});
