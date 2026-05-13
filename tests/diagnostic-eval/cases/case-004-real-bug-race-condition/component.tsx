import { useEffect, useState } from 'react';

type User = { id: string };
type Prefs = { theme: 'light' | 'dark' };

export function PreferencesPanel(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ theme: 'light' });

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setUser);
  }, []);

  useEffect(() => {
    if (user === null) return;
    fetch(`/api/prefs/${user.id}`).then((r) => r.json()).then(setPrefs);
  }, []);

  return <div data-testid="prefs-theme">{prefs.theme}</div>;
}
