export function LoginPage(): JSX.Element {
  return (
    <div data-testid="login-card">
      <input data-testid="email-input" />
      <input data-testid="password-input" type="password" />
      <button data-testid="login-submit">Sign in</button>
      <div data-testid="login-error" role="alert">invalid credentials</div>
    </div>
  );
}
