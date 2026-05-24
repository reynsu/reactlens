import * as React from 'react';

type AuthState = {
  user: { id: string; name: string } | undefined;
  error: 'TokenExpired' | 'InvalidCredentials' | undefined;
};

function useAuth(): AuthState {
  const [state, setState] = React.useState<AuthState>({ user: undefined, error: undefined });
  React.useEffect(() => {
    const tokenStr = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
    if (tokenStr === null) {
      setState({ user: undefined, error: undefined });
      return;
    }
    try {
      const token = JSON.parse(tokenStr) as { exp: number; sub: string; name: string };
      if (token.exp < Date.now()) throw new Error('TokenExpired');
      setState({ user: { id: token.sub, name: token.name }, error: undefined });
    } catch {
      setState({ user: undefined, error: undefined });
    }
  }, []);
  return state;
}

export function Greeting(): JSX.Element {
  const { user } = useAuth();
  if (user === undefined) {
    return <h1 data-testid="greeting">Hello, Guest!</h1>;
  }
  return <h1 data-testid="greeting">Hello, {user.name}!</h1>;
}
