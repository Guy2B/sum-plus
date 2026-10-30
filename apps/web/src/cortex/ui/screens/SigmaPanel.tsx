/** Σ's three decisions, with the reason NEXT gives for each. */
import { Icon } from '../../../ui/icons';
import { ct } from '../../i18n';
import { editDay, getDay, today } from '../../data';
import { Panel } from '../parts';
import { sigmaDecisions, sigmaWhy } from '../sigma';
import { decisionTitle } from '../../../ui/decision-card';
import { toast } from '../../../ui/components';

export function SigmaPanel() {
  const list = sigmaDecisions().slice(0, 3);
  if (!list.length) return null;
  const k = today.value;
  const taken = new Set(getDay(k).priorities.map((p) => p.title.trim()));
  return (
    <Panel
      title={
        <>
          <Icon name="sigma" size={16} /> {ct('sigma.title')}
        </>
      }
      actions={
        <a class="btn btn-ghost btn-sm" href="app.html#today">
          {ct('sigma.openNext')}
        </a>
      }
    >
      <ol class="cx-sigma">
        {list.map((d) => {
          const title = decisionTitle(d);
          const isTaken = taken.has(title.slice(0, 120).trim());
          return (
            <li key={d.signal.id}>
              <div>
                <b>{title}</b>
                <span class="muted">{sigmaWhy(d)}</span>
              </div>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                disabled={isTaken}
                onClick={() =>
                  void editDay(k, (x) => {
                    const i = x.priorities.findIndex((p) => !p.title.trim());
                    const item = {
                      title: title.slice(0, 120),
                      done: false,
                      taskId: d.signal.ref.collection === 'tasks' ? d.signal.ref.id : null,
                    };
                    if (i >= 0) x.priorities[i] = item;
                    else x.priorities[2] = item;
                  }).then(() => toast(ct('sigma.added'), 'good'))
                }
              >
                {isTaken ? ct('sigma.inPriorities') : ct('sigma.makePriority')}
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
