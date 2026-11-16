import React, { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { TourEditor } from './components/TourEditor';
import { Wizard } from './components/Wizard';
import { AuthScreen } from './components/AuthScreen';
import { useTourStore } from './store/useTourStore';
import { api, type SessionUser } from './api';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'dashboard' | 'wizard' | 'editor'>('dashboard');
  const activeProject = useTourStore(state => state.activeProject);

  // null = still checking; undefined = signed out.
  const [user, setUser] = useState<SessionUser | null | undefined>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .authStatus()
      .then(status => {
        if (cancelled) return;
        setNeedsSetup(status.needsSetup);
        setUser(status.user ?? undefined);
      })
      .catch(() => {
        // Server unreachable or misconfigured — show the sign-in screen rather
        // than a blank page, so the failure is at least explicable.
        if (!cancelled) setUser(undefined);
      });
    return () => { cancelled = true; };
  }, []);

  if (user === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f8fafc] text-sm font-medium text-slate-400">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onSignedIn={u => { setUser(u); setNeedsSetup(false); }}
      />
    );
  }

  if (currentScreen === 'editor' && activeProject) {
    return <TourEditor onBackToDashboard={() => setCurrentScreen('dashboard')} />;
  }

  if (currentScreen === 'wizard') {
    return (
      <Wizard
        onComplete={() => setCurrentScreen('editor')}
        onCancel={() => setCurrentScreen('dashboard')}
      />
    );
  }

  return (
    <Dashboard
      onStartWizard={() => setCurrentScreen('wizard')}
      onOpenEditor={() => setCurrentScreen('editor')}
    />
  );
};

export default App;
