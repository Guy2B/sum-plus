import { expect, type Page } from '@playwright/test';

/** Fails the test on any uncaught page error or console error. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function onboard(
  page: Page,
  opts: { name?: string; editionIndex?: number; demo?: boolean } = {},
) {
  await page.goto('/app.html');
  await expect(page.getByRole('heading', { name: 'Bienvenue dans Σ' })).toBeVisible();
  await page.getByLabel('Prénom ou nom affiché').fill(opts.name ?? 'Camille');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page
    .getByRole('radio')
    .nth(opts.editionIndex ?? 1)
    .click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Objectif principal').fill('Signer trois nouveaux clients');
  await page.getByRole('button', { name: opts.demo ? 'Essayer avec des exemples' : 'Commencer' }).click();
  await expect(page).toHaveURL(/#today/);
}
