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
    await expect(page.locator('.cx-welcome-progress')).toHaveText('0/4 pour bien démarrer');

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
    // Everyday habits are ready from the first opening (free plan: the first three).
    await expect(page.getByRole('button', { name: 'Boire de l’eau : 0 sur 8' })).toBeVisible();
    await page.getByRole('button', { name: 'Au lit avant 23 h : à faire' }).click();
    await expect(page.getByRole('button', { name: 'Au lit avant 23 h : fait' })).toBeVisible();

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

  test('dictation: speak a note, it is saved with its first words as title', async ({ page }) => {
    const errors = watchErrors(page);
    // A stand-in for the browser's speech recognition.
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = '';
        continuous = false;
        interimResults = false;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          (window as unknown as { __rec: FakeRecognition }).__rec = this;
        }
        stop() {
          this.onend?.();
        }
        say(text: string) {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
        }
      }
      const w = window as unknown as Record<string, unknown>;
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    });
    await page.goto('/cortex.html#notes');
    await page.locator('.page-actions').getByRole('button', { name: 'Dicter une note' }).click();
    await expect(page.locator('#n-body')).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { __rec: { say(t: string): void } }).__rec.say(
        'idée de chapitre sur le port de Douala',
      ),
    );
    await expect(page.locator('#n-body')).toHaveValue('Idée de chapitre sur le port de Douala.');
    await expect(page.locator('#n-title')).toHaveValue('Idée de chapitre sur le port de Douala');
    await page.locator('.cx-note-bar').getByRole('button', { name: 'Arrêter la dictée' }).click();
    await expect(
      page.locator('.cx-note-bar').getByRole('button', { name: 'Dicter', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the planner explains itself until the person has planned once', async ({ page }) => {
    await page.goto('/cortex.html#planning');
    const guide = page.getByRole('heading', { name: 'Planifier votre journée en 3 gestes' });
    await expect(guide).toBeVisible();
    await page.getByRole('button', { name: 'J’ai compris' }).click();
    await expect(guide).toBeHidden();
    await page.getByRole('button', { name: 'Comment planifier ?' }).click();
    await expect(guide).toBeVisible();
  });

  test('the four NEXT languages are one tap away', async ({ page }) => {
    await page.goto('/cortex.html');
    await page.getByRole('button', { name: 'Deutsch' }).click();
    await expect(page.getByRole('heading', { name: 'Willkommen bei Cortex' })).toBeVisible();
    await page.getByRole('button', { name: 'Español' }).click();
    await expect(page.getByRole('heading', { name: 'Te damos la bienvenida a Cortex' })).toBeVisible();
    await page.getByRole('button', { name: 'Français' }).click();
    await expect(page.getByRole('heading', { name: 'Bienvenue dans Cortex' })).toBeVisible();
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
