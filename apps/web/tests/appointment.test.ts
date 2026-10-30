import { describe, expect, it } from 'vitest';
import { parseAppointment } from '../src/domain/appointment';

// Friday 30 October 2026, 10:00
const NOW = new Date(2026, 9, 30, 10, 0);
const at = (a: ReturnType<typeof parseAppointment>) =>
  a &&
  `${a.start.getFullYear()}-${a.start.getMonth() + 1}-${a.start.getDate()} ${a.start.getHours()}:${String(a.start.getMinutes()).padStart(2, '0')}`;

describe('appointments in pasted messages', () => {
  it.each([
    ['On se voit mardi à 15h au Café Lou', '2026-11-3 15:00'],
    ['RDV dentiste le 12/11 à 9h30', '2026-11-12 9:30'],
    ['Termin beim Zahnarzt am 12.11. um 9:30 Uhr', '2026-11-12 9:30'],
    ['Call with Sarah tomorrow 3pm', '2026-10-31 15:00'],
    ['Cita el 14 de noviembre a las 10', '2026-11-14 10:00'],
    ['Réunion projet demain 14:00', '2026-10-31 14:00'],
    ['Dinner on November 20 at 7:30 pm', '2026-11-20 19:30'],
    ['Visio aujourd’hui 16h', '2026-10-30 16:00'],
    ['Anniversaire de Léa le 3 janvier', '2027-1-3 9:00'],
    ['Point à 9h', '2026-10-31 9:00'],
    ['Morgen 10 Uhr Meeting mit Jan', '2026-10-31 10:00'],
    ['[30/10/26, 09:12] Marc: On dîne jeudi 20h chez moi ?', '2026-11-5 20:00'],
    ['30.10.26, 09:12 - Marc: On dîne jeudi 20h chez moi ?', '2026-11-5 20:00'],
  ])('%s', (text, expected) => {
    expect(at(parseAppointment(text, NOW))).toBe(expected);
  });

  it('keeps a readable title and the place', () => {
    const a = parseAppointment('On se voit mardi à 15h au Café Lou', NOW)!;
    expect(a.title).toBe('On se voit au Café Lou');
    expect(a.location).toBe('Café Lou');
    expect(parseAppointment('RDV dentiste le 12/11 à 9h30', NOW)!.title).toBe('RDV dentiste');
    expect(parseAppointment('Call with Sarah tomorrow 3pm', NOW)!.title).toBe('Call with Sarah');
  });

  it('says when the day or the time was guessed', () => {
    expect(parseAppointment('Anniversaire de Léa le 3 janvier', NOW)).toMatchObject({
      timed: false,
      dated: true,
    });
    expect(parseAppointment('Point à 9h', NOW)).toMatchObject({ timed: true, dated: false });
    expect(parseAppointment('Merci pour hier, à bientôt !', NOW)).toBeNull();
  });
});
