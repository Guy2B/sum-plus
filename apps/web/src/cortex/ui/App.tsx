import { ready } from '../../data/store';
import { route } from '../router';
import { Shell } from './Shell';
import { Today } from './screens/Today';
import { Planning } from './screens/Planning';
import { Habits } from './screens/Habits';
import { Inbox, Notes, ProjectPage, Projects, Tasks, Writing } from './screens/Brain';
import { Review } from './screens/Review';
import { ct } from '../i18n';

function Screen() {
  switch (route.value.id) {
    case 'planning':
      return <Planning />;
    case 'habits':
      return <Habits />;
    case 'inbox':
      return <Inbox />;
    case 'tasks':
      return <Tasks />;
    case 'projects':
      return <Projects />;
    case 'project':
      return <ProjectPage />;
    case 'notes':
      return <Notes />;
    case 'writing':
      return <Writing />;
    case 'review':
      return <Review />;
    default:
      return <Today />;
  }
}

export function CortexApp() {
  return (
    <Shell>
      {ready.value ? (
        <Screen />
      ) : (
        <div class="cx-loading" role="status">
          {ct('app.loading')}
        </div>
      )}
    </Shell>
  );
}
