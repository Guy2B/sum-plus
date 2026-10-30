/** Cortex is included in NEXT Pro: it opens NEXT's own upgrade dialog. */
import { openUpgrade as openNextUpgrade } from '../../ui/pro';

export type CortexGate = 'habits' | 'projects' | 'notes' | 'routines' | 'writing' | 'review';

export function openUpgrade(gate: CortexGate): void {
  openNextUpgrade(gate === 'habits' ? 'habits' : gate === 'projects' ? 'projects' : 'feature');
}
