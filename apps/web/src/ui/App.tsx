import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ready, settings } from '../data/store';
import { t } from '../i18n';
import { Shell } from './shell';
import { route, type RouteId } from './router';
import { ConfirmHost, ToastHost, Spinner, Button } from './components';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { Attention } from './screens/Attention';
import { Plan } from './screens/Plan';
import { Coach } from './screens/Coach';
import { Sources } from './screens/Sources';
import { Tasks } from './screens/Tasks';
import { Projects } from './screens/Projects';
import { Calendar } from './screens/Calendar';
import { Goals } from './screens/Goals';
import { Journal } from './screens/Journal';
import { Missions } from './screens/Missions';
import { Learning } from './screens/Learning';
import { Finance } from './screens/Finance';
import { Health } from './screens/Health';
import { Household } from './screens/Household';
import { Career } from './screens/Career';
import { Mail } from './screens/Mail';
import { Social } from './screens/Social';
import { Context } from './screens/Context';
import { Account } from './screens/Account';
import { Admin } from './screens/Admin';
import type { FunctionComponent } from 'preact';

const SCREENS: Record<RouteId, FunctionComponent> = {
  today: Today,
  attention: Attention,
  plan: Plan,
  coach: Coach,
  sources: Sources,
  tasks: Tasks,
  projects: Projects,
  calendar: Calendar,
  goals: Goals,
  journal: Journal,
  missions: Missions,
  learning: Learning,
  finance: Finance,
  health: Health,
  household: Household,
  career: Career,
  mail: Mail,
  social: Social,
  context: Context,
  account: Account,
  admin: Admin,
};

export const updateAvailable = signal<null | (() => void)>(null);
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

function Banners() {
  useEffect(() => {
    const on = () => (online.value = true);
    const off = () => (online.value = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return (
    <>
      {!online.value && (
        <div class="banner banner-offline" role="status">
          {t('app.offline')}
        </div>
      )}
      {updateAvailable.value && (
        <div class="banner" role="status">
          <span>{t('app.updateAvailable')}</span>
          <Button size="sm" variant="primary" onClick={() => updateAvailable.value?.()}>
            {t('app.reload')}
          </Button>
        </div>
      )}
    </>
  );
}

export function App() {
  if (!ready.value) return <Spinner label={t('common.loading')} />;
  if (!settings.value.onboardingComplete) {
    return (
      <>
        <Onboarding />
        <ToastHost />
      </>
    );
  }
  const Screen = SCREENS[route.value.id] ?? Today;
  return (
    <>
      <Shell banner={<Banners />}>
        <Screen key={route.value.id} />
      </Shell>
      <ConfirmHost />
      <ToastHost />
    </>
  );
}
