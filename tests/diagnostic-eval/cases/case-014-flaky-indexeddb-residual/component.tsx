import { useEffect, useState } from 'react';

const DB_NAME = 'reactlens-eval';
const STORE = 'onboarding';

async function readOnboardingComplete(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        resolve(false);
        return;
      }
      const tx = db.transaction(STORE, 'readonly');
      const getReq = tx.objectStore(STORE).get('completed');
      getReq.onsuccess = () => resolve(getReq.result === true);
      getReq.onerror = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  });
}

export function OnboardingGate(): JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'show' | 'skip'>('loading');

  useEffect(() => {
    let cancelled = false;
    readOnboardingComplete().then((done) => {
      if (cancelled) return;
      setPhase(done ? 'skip' : 'show');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'loading') return <div data-testid="onboarding-loading">…</div>;
  if (phase === 'show') return <div data-testid="onboarding-card">Welcome! Let's set up your account.</div>;
  return <div data-testid="onboarding-skipped">Welcome back</div>;
}
