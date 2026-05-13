import { useEffect, useState } from 'react';

type Auth = { authenticated: boolean };

function readSessionCookie(): boolean {
  return document.cookie.split(';').some((c) => c.trim().startsWith('app_session='));
}

export function Landing(): JSX.Element {
  const [auth, setAuth] = useState<Auth>({ authenticated: false });

  useEffect(() => {
    setAuth({ authenticated: readSessionCookie() });
  }, []);

  if (auth.authenticated) {
    return <div data-testid="dashboard-shell">Welcome back</div>;
  }
  return (
    <div data-testid="landing-anonymous">
      <h1>Welcome</h1>
      <a href="/login" data-testid="landing-sign-in">Sign in</a>
    </div>
  );
}
