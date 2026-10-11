import { describe, expect, it } from 'vitest';
import { sharedText, splitNote } from '../src/domain/notes';

describe('splitNote', () => {
  it('turns bullet and checkbox items into tasks, skips ticked ones', () => {
    const n = splitNote('Courses samedi\n- lait\n• pain\n[ ] appeler la banque\n[x] payer loyer\n☑ poste');
    expect(n.title).toBe('Courses samedi');
    expect(n.tasks).toEqual(['lait', 'pain', 'appeler la banque']);
    expect(n.done).toBe(2);
  });

  it('treats a short list without bullets as items', () => {
    expect(splitNote('Appeler Marc\nEnvoyer devis Lune\nRéserver garage').tasks).toEqual([
      'Appeler Marc',
      'Envoyer devis Lune',
      'Réserver garage',
    ]);
  });

  it('keeps prose as a note only', () => {
    const prose = 'Idée pour le salon. '.repeat(12);
    const n = splitNote(`${prose}\n${prose}`);
    expect(n.tasks).toEqual([]);
    expect(n.text.length).toBeGreaterThan(100);
  });

  it('accepts numbered lists and removes duplicates', () => {
    expect(splitNote('1. Test\n2) Test\n3. Autre').tasks).toEqual(['Test', 'Autre']);
  });

  it('single short line becomes one task', () => {
    expect(splitNote('Rappeler le dentiste demain').tasks).toEqual(['Rappeler le dentiste demain']);
  });
});

describe('sharedText', () => {
  it('joins title, text and url without repeating them', () => {
    const p = new URLSearchParams({ title: 'Liste', text: 'Liste\n- a', url: 'https://x.y' });
    expect(sharedText(p)).toBe('Liste\nListe\n- a\nhttps://x.y');
    expect(sharedText(new URLSearchParams({ text: 'a', title: 'a' }))).toBe('a');
  });
});
