import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { login } from '../api/client';

const schema = z.object({
  email: z.string().email('enter a valid email'),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues): Promise<void> {
    setServerError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      await navigate({ to: '/dashboard' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'login failed';
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" data-testid="login-card">
      <h1>Sign in</h1>
      {serverError !== null && (
        <div className="banner error" data-testid="login-error" role="alert">
          {serverError}
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" data-testid="email-input" {...register('email')} />
          {errors.email !== undefined && (
            <span className="error" data-testid="email-error">
              {errors.email.message}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            data-testid="password-input"
            {...register('password')}
          />
          {errors.password !== undefined && (
            <span className="error" data-testid="password-error">
              {errors.password.message}
            </span>
          )}
        </div>
        <button type="submit" disabled={submitting} data-testid="login-submit">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
