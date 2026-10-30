/**
 * The bridge to NEXT's decision engine: Σ's three explained decisions become
 * the day's priorities, and Σ's suggested day becomes editable blocks.
 */
import type { DayPriority, ISODate, TimeBlock } from '../../domain/types';
import type { Decision } from '../../domain/decision';
import { visibleTop } from '../../data/actions';
import { dayBlocks } from '../../data/store';
import { t } from '../../i18n';
import { decisionTitle } from '../../ui/decision-card';
import { blocksFromPlan } from '../model';
import { newBlockId } from '../data';

export function sigmaDecisions(): Decision[] {
  return visibleTop.value.selected;
}

export function sigmaPriorities(): DayPriority[] {
  return sigmaDecisions()
    .slice(0, 3)
    .map((d) => ({
      title: decisionTitle(d).slice(0, 120),
      done: false,
      taskId: d.signal.ref.collection === 'tasks' ? d.signal.ref.id : null,
    }));
}

/** First reason Σ gives for a decision, in the user's language. */
export function sigmaWhy(d: Decision): string {
  const r = d.reasons[0];
  return r ? t(r.key, r.params) : '';
}

/** Σ's plan for today, as blocks that fit around what is already planned. */
export function sigmaBlocks(existing: TimeBlock[], _date: ISODate): TimeBlock[] {
  return blocksFromPlan(
    dayBlocks.value,
    existing,
    (b) => (b.titleKey ? t(b.titleKey, b.titleParams) : (b.title ?? '')),
    newBlockId,
  );
}
