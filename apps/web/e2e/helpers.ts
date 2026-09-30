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
  opts: { name?: string; profileIndex?: number; demo?: boolean; mind?: string[] } = {},
) {
  await page.goto('/app.html');
  await page.getByRole('button', { name: /Commencer avec mes données/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Qu’est-ce qui occupe votre esprit aujourd’hui ?' }),
  ).toBeVisible();
  if (opts.mind?.length) await page.getByLabel('Ce qui vous occupe').fill(opts.mind.join('\n'));
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Prénom ou nom affiché').fill(opts.name ?? 'Camille');
  await page
    .getByRole('radio')
    .nth(opts.profileIndex ?? 1)
    .click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Votre premier plan est prêt' })).toBeVisible();
  await page.getByRole('button', { name: opts.demo ? 'Essayer avec des exemples' : 'Voir mon plan' }).click();
  await expect(page).toHaveURL(/#today/);
}
