import { useState, type FormEvent } from 'react';

type SignupErrors = Partial<Record<'email' | 'password' | 'terms', string>>;

export function SignupForm(props: { onSubmit: (data: { email: string; password: string }) => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [pending, setPending] = useState(false);

  function validate(): SignupErrors {
    const e: SignupErrors = {};
    if (!email.includes('@')) e.email = 'Enter a valid email';
    if (password.length < 8) e.password = 'Password must be at least 8 characters';
    // Added in PR #482 — GDPR/ToS gating made the checkbox required.
    if (!terms) e.terms = 'You must accept the terms of service to sign up';
    return e;
  }

  async function handleSubmit(ev: FormEvent): Promise<void> {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setPending(true);
    try {
      await props.onSubmit({ email, password });
    } finally {
      setPending(false);
    }
  }

  return (
    <form data-testid="signup-form" onSubmit={handleSubmit}>
      <input data-testid="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {errors.email !== undefined && <span data-testid="email-error">{errors.email}</span>}
      <input data-testid="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {errors.password !== undefined && <span data-testid="password-error">{errors.password}</span>}
      <label>
        <input data-testid="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        I accept the terms of service
      </label>
      {errors.terms !== undefined && <span data-testid="terms-error">{errors.terms}</span>}
      <button type="submit" data-testid="submit" disabled={pending}>{pending ? 'Signing up…' : 'Sign up'}</button>
    </form>
  );
}
