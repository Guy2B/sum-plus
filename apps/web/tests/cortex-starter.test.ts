import { describe, expect, it } from 'vitest';

describe('Cortex first opening', () => {
  it('removes demo examples, adds the starter habits once, and never brings them back', async () => {
    const store = await import('../src/data/store');
    const { prepareWorkspace, STARTER_HABITS } = await import('../src/cortex/starter');
    const { FREE_LIMITS, isPro } = await import('../src/domain/entitlements');
    await store.initStore();
    await store.create('tasks', {
      id: 'demo_task1',
      title: 'Devis pour Marc',
      category: 'work',
      status: 'todo',
      priority: 'medium',
    } as never);
    await store.create('habits', {
      id: 'demo_h1',
      name: 'Demo',
      cadence: 'daily',
      domain: 'personal',
    } as never);

    await prepareWorkspace();
    const live = () => store.snapshot.value.habits.filter((h) => !h.deletedAt);
    expect(store.snapshot.value.tasks.filter((t) => !t.deletedAt)).toEqual([]);
    const expected = isPro(store.entitlement.value) ? STARTER_HABITS.length : FREE_LIMITS.habits;
    expect(live()).toHaveLength(expected);
    expect(live().map((h) => h.icon)).toEqual(STARTER_HABITS.slice(0, expected).map((s) => s.icon));
    expect(live().find((h) => h.icon === 'drop')).toMatchObject({ target: 8 });

    await prepareWorkspace();
    expect(live()).toHaveLength(expected);

    for (const h of live()) await store.remove('habits', h.id);
    await prepareWorkspace();
    expect(live()).toEqual([]);
  });
});

describe('dictation into notes', () => {
  it('turns each spoken phrase into a sentence appended to the note', async () => {
    const { sentence } = await import('../src/cortex/data');
    expect(sentence('  appeler le fournisseur demain ')).toBe('Appeler le fournisseur demain.');
    expect(sentence('est-ce que ça marche ?')).toBe('Est-ce que ça marche ?');
    expect(sentence('   ')).toBe('');
  });
});

describe('starter habits follow the language', () => {
  it('renames untouched starter habits, never renamed ones', async () => {
    const store = await import('../src/data/store');
    const { relocalizeStarters } = await import('../src/cortex/starter');
    const { ensureCortexLocale } = await import('../src/cortex/i18n');
    await store.initStore();
    await ensureCortexLocale('en');
    const a = await store.create('habits', {
      name: 'Drink water',
      unit: 'glasses',
      cadence: 'daily',
      domain: 'personal',
    } as never);
    const b = await store.create('habits', {
      name: 'Water, lots of it',
      cadence: 'daily',
      domain: 'personal',
    } as never);
    await store.updateSettings({ locale: 'fr' });
    await relocalizeStarters();
    const get = (id: string) => store.snapshot.value.habits.find((h) => h.id === id)!;
    expect(get(a.id)).toMatchObject({ name: 'Boire de l’eau', unit: 'verres' });
    expect(get(b.id).name).toBe('Water, lots of it');
  });
});
