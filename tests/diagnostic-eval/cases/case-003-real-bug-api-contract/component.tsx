import { useEffect, useState } from 'react';

type User = { id: string; displayName: string };

export function WelcomeBanner(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then(setUser);
  }, []);

  if (user === null) return <div data-testid="welcome-skeleton">…</div>;
  const name = (user as unknown as { fullName?: string }).fullName ?? '';
  return <div data-testid="welcome-banner">Welcome, {name}!</div>;
}
