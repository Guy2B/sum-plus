import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { onboard, watchErrors } from './helpers';

test.describe('core journey', () => {
  test('onboarding with examples yields three explained decisions', async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page, { name: 'Camille', demo: true });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Camille');
    const cards = page.locator('#top3 .decision');
    await expect(cards).toHaveCount(3);
    await cards.first().getByRole('button', { name: 'Pourquoi ?' }).click();
    await expect(cards.first().locator('.decision-explain li').first()).toBeVisible();
    await expect(page.locator('.sources-line')).toContainText('Basé sur');
    expect(errors).toEqual([]);
  });

  test('quick capture parses natural language and persists across reloads', async ({ page }) => {
    await onboard(page);
    await page.getByRole('textbox', { name: 'Capture rapide' }).fill('Appeler Marc demain 30min !');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Ajouté : Appeler Marc')).toBeVisible();
    await page.goto('/app.html#tasks');
    await page.getByRole('tab', { name: /Toutes/ }).click();
    const row = page.locator('.task-row', { hasText: 'Appeler Marc' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Haute')).toBeVisible();
    await expect(row.getByText('30 min')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: /Toutes/ }).click();
    await expect(page.locator('.task-row', { hasText: 'Appeler Marc' })).toBeVisible();
  });

  test('acting on a decision removes it and records feedback', async ({ page }) => {
    await onboard(page, { demo: true });
    const first = page.locator('#top3 .decision').first();
    const title = (await first.locator('.decision-title').innerText()).trim();
    await first.locator('.decision-actions .btn-primary').click();
    await expect(page.locator('#top3 .decision-title', { hasText: title })).toHaveCount(0);
  });

  test('coach cites only real sources and never invents data', async ({ page }) => {
    await onboard(page);
    await page.goto('/app.html#coach');
    await page.getByLabel('Que dois-je faire en priorité ?').fill('Comment va ma trésorerie ?');
    await page.getByRole('button', { name: 'Envoyer' }).click();
    const answer = page.locator('.bubble-assistant').last();
    await expect(answer).toContainText('Aucune donnée financière');
    await expect(answer).toContainText('Aucune donnée disponible pour répondre');
  });

  test('language and edition switches apply everywhere without data loss', async ({ page }) => {
    await onboard(page, { demo: true });
    await page.goto('/app.html#account');
    await page.getByLabel('Langue').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
    await page.getByRole('radio', { name: /Creator/ }).click();
    await page.goto('/app.html#today');
    await expect(page.locator('.brand small')).toContainText('Creator');
    await expect(page.locator('#top3 .decision').first()).toBeVisible();
  });

  test('pro features are gated server-side style in the UI', async ({ page }) => {
    await onboard(page);
    await page.goto('/app.html#finance');
    await expect(page.getByRole('button', { name: 'Découvrir Σ Pro' })).toBeVisible();
    await page.goto('/app.html#health');
    await expect(page.getByRole('button', { name: 'Découvrir Σ Pro' })).toBeVisible();
  });

  test('backup export produces a valid Σ backup file', async ({ page }) => {
    await onboard(page, { demo: true });
    await page.goto('/app.html#account/data');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exporter (JSON)' }).click(),
    ]);
    const content = JSON.parse(
      await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')),
    );
    expect(content.format).toBe('sigma-life-os-backup');
    expect(content.collections.tasks.length).toBeGreaterThan(0);
  });

  test('legacy V1–V8 data is migrated on first launch', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(
        'sum-algbr-state-v1',
        JSON.stringify({
          settings: { name: 'Legacy User', profile: 'solo', onboardingComplete: true, currency: 'EUR' },
          tasks: [{ id: 'old1', title: 'Tâche héritée', priority: 'high', done: false }],
        }),
      );
    });
    await page.goto('/app.html');
    await expect(page.getByText(/récupéré/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Legacy User');
    await page.goto('/app.html#tasks');
    await page.getByRole('tab', { name: /Toutes/ }).click();
    await expect(page.locator('.task-row', { hasText: 'Tâche héritée' })).toBeVisible();
  });

  test('a mission becomes a dated plan with a forecast and adapts to logged sessions', async ({ page }) => {
    await onboard(page);
    await page.goto('/app.html#missions');
    await page.getByRole('button', { name: /Préparer un examen/ }).click();
    await page.getByLabel('Intitulé').fill('Contrôle de maths');
    const date = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Date', { exact: true }).fill(date);
    await page.getByLabel('Chapitres ou thèmes').fill(['Fractions', 'Géométrie'].join('\n'));
    await page.getByRole('button', { name: 'Créer le plan' }).click();
    const card = page.locator('.mission', { hasText: 'Contrôle de maths' });
    await expect(card.getByText(/Préparation estimée à \d+ % le jour J/)).toBeVisible();
    await expect(card.getByText(/Réviser « (Fractions|Géométrie) »/)).toBeVisible();
    await card.getByRole('button', { name: 'Fait', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
    await expect(page.getByText('Séance enregistrée, plan recalculé')).toBeVisible();
    await expect(card.getByText('Pas de séance prévue aujourd’hui.')).toBeVisible();
  });

  test('works offline after the first visit (PWA)', async ({ page, context }) => {
    await onboard(page, { demo: true });
    await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.getRegistration()));
    await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 })
      .catch(async () => page.reload());
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#top3')).toBeVisible();
    await expect(page.getByText('Hors ligne')).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('accessibility', () => {
  for (const route of [
    'today',
    'attention',
    'plan',
    'coach',
    'tasks',
    'calendar',
    'goals',
    'journal',
    'sources',
    'context',
    'account',
  ]) {
    test(`no serious a11y violations on #${route}`, async ({ page }) => {
      await onboard(page, { demo: true });
      await page.goto(`/app.html#${route}`);
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        serious.map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }

  test('landing and legal pages are accessible', async ({ page }) => {
    for (const path of ['/', '/legal/privacy.html', '/legal/terms.html', '/legal/support.html']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${path} ${v.id}`),
      ).toEqual([]);
    }
  });
});
