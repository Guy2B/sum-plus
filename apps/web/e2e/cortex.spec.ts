import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { watchErrors } from './helpers';

const capture = async (page: Page, text: string) => {
  await page.locator('#cx-capture').fill(text);
  await page.locator('#cx-capture').press('Enter');
};

test.describe('Cortex', () => {
  test('day journey: capture, priorities, habit, planning, shared with NEXT', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/cortex.html');
    await expect(page.getByRole('heading', { name: 'Bienvenue dans Cortex' })).toBeVisible();

    // Capture lands in the inbox, then is filed for today.
    await capture(page, 'Envoyer le devis Müller 30min');
    await page.getByRole('link', { name: /Boîte de réception/ }).click();
    await expect(page.locator('.cx-inbox li')).toHaveCount(1);
    await page.locator('.cx-inbox').getByRole('button', { name: 'Aujourd’hui' }).click();
    await expect(page.locator('.cx-inbox li')).toHaveCount(0);

    // A priority and a habit.
    await page
      .getByRole('link', { name: /Aujourd’hui/ })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Priorité 1' }).fill('Finir le rapport');
    await page
      .getByRole('link', { name: /Habitudes/ })
      .first()
      .click();
    await page.locator('.page-actions').getByRole('button', { name: 'Habitude' }).click();
    await page.getByLabel('Nom').fill('Lire 20 minutes');
    await page.getByRole('dialog').getByRole('button', { name: 'Ajouter' }).click();
    await page.getByRole('button', { name: 'Lire 20 minutes : à faire' }).click();
    await expect(page.getByRole('button', { name: 'Lire 20 minutes : fait' })).toBeVisible();

    // Planning: place the task, tick its block, and the task is done in NEXT too.
    await page
      .getByRole('link', { name: /Planning/ })
      .first()
      .click();
    const row = page.locator('.cx-task', { hasText: 'Envoyer le devis Müller' });
    await row.getByRole('button', { name: 'Planifier' }).click();
    const blockEl = page.locator('.cx-bk', { hasText: 'Envoyer le devis Müller' });
    await expect(blockEl).toBeVisible();
    await blockEl.getByRole('button', { name: 'Terminé' }).click();
    await expect(page.locator('.cx-task.done', { hasText: 'Envoyer le devis Müller' })).toBeVisible();
    // NEXT opens on the same origin and store.
    await page.goto('/app.html#tasks');
    await expect(page).toHaveTitle(/NEXT/);
    await page.goto('/cortex.html#tasks');
    await expect(page.locator('.cx-task.done', { hasText: 'Envoyer le devis Müller' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('notes link to each other and show backlinks', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/cortex.html#notes');
    await page.locator('.page-actions').getByRole('button', { name: 'Nouvelle note' }).click();
    await page.locator('#n-title').fill('Roman');
    await page.locator('#n-body').fill('Voir [[Personnages]].');
    await page.getByRole('button', { name: 'Personnages · créer' }).click();
    await expect(page.locator('#n-title')).toHaveValue('Personnages');
    await expect(page.locator('.cx-links')).toContainText('Roman');
    expect(errors).toEqual([]);
  });

  test('every view renders without errors or serious accessibility issues', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/cortex.html');
    await capture(page, 'Tâche témoin aujourd’hui');
    for (const view of [
      'today',
      'planning',
      'habits',
      'inbox',
      'tasks',
      'projects',
      'notes',
      'writing',
      'review',
    ]) {
      await page.goto(`/cortex.html#${view}`);
      await expect(page.locator('#main h1')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        serious.map((v) => `${view} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
