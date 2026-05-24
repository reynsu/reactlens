// Synthetic moat-validation case (Type C: correct branch, wrong reason).
//
// The Greeting component renders one of two branches based on auth state:
//   user !== undefined  → "Hello, <name>!"
//   user === undefined  → "Hello, Guest!"
// The "Guest" branch is a LEGITIMATE product state (logged-out user).
//
// Bug: useAuth swallows token-expiry errors and returns `undefined` for
// the user, identical to "never logged in." The DOM renders "Hello,
// Guest!" — which looks like the user simply isn't logged in. The
// underlying error (`TokenExpired`) is hidden in the hook's state but
// never surfaced.
//
// What a black-box (DOM-only) tool sees on test failure:
//   "Expected 'Hello, Alice!', got 'Hello, Guest!'"
// Plausible hypotheses without component-tree info: login failed, Alice
// doesn't exist, auth setup wrong in the test, MSW handler bad, race
// condition with the auth bootstrap, etc.
//
// What a component-tree-aware tool sees: the useAuth hook's state holds
// `{ user: undefined, error: 'TokenExpired' }`. That immediately
// distinguishes "user never logged in" (no error) from "user was logged
// in but token expired" (the actual bug).

import * as React from 'react';

type AuthState = {
  user: { id: string; name: string } | undefined;
  error: 'TokenExpired' | 'InvalidCredentials' | undefined;
};

// Simulated token-validating auth provider. In real apps this would be
// react-query's useQuery wrapping a /me endpoint.
function useAuth(): AuthState {
  const [state, setState] = React.useState<AuthState>({ user: undefined, error: undefined });
  React.useEffect(() => {
    // Fake bootstrap: read token from localStorage, validate, populate user.
    // Bug: the catch block returns { user: undefined } WITHOUT also
    // surfacing the error to the caller. The caller can't distinguish
    // "no session" from "expired session" — and the latter needs a
    // re-login prompt, while the former needs the login page.
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
      // BUG: error is swallowed entirely — caller sees the same shape as
      // "no token." Should be: setState({ user: undefined, error: 'TokenExpired' }).
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
