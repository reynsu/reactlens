'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { submitCheckout, CheckoutError } from '@/lib/api-client';

const schema = z.object({
  cardNumber: z
    .string()
    .min(16, 'card number must be 16 digits')
    .regex(/^\d+$/, 'digits only'),
  cvv: z
    .string()
    .min(3, 'cvv must be 3 or 4 digits')
    .max(4, 'cvv must be 3 or 4 digits')
    .regex(/^\d+$/, 'digits only'),
  amount: z.coerce.number().positive('amount must be greater than 0'),
});

type FormValues = z.infer<typeof schema>;
type Status = 'idle' | 'submitting' | 'success' | 'declined' | 'network-error';

export function CheckoutPage(): JSX.Element {
  const [status, setStatus] = useState<Status>('idle');
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cardNumber: '', cvv: '', amount: 0 },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setStatus('submitting');
    try {
      const result = await submitCheckout(values);
      setConfirmation(result.confirmationId);
      setStatus('success');
    } catch (err) {
      if (err instanceof CheckoutError && err.code === 'declined') {
        setStatus('declined');
      } else {
        setStatus('network-error');
      }
    }
  }

  if (status === 'success' && confirmation !== null) {
    return (
      <div className="card" data-testid="checkout-success">
        <div className="banner success">
          Payment accepted. Confirmation: <code>{confirmation}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="checkout-card">
      <h1>Checkout</h1>
      {status === 'declined' && (
        <div className="banner error" role="alert" data-testid="checkout-declined">
          Card declined. Try a different card.
        </div>
      )}
      {status === 'network-error' && (
        <div className="banner error" role="alert" data-testid="checkout-network-error">
          Network error. Please try again.
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="cardNumber">Card number</label>
          <input id="cardNumber" data-testid="card-input" {...register('cardNumber')} />
          {errors.cardNumber !== undefined && (
            <span className="error" data-testid="card-error">
              {errors.cardNumber.message}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="cvv">CVV</label>
          <input id="cvv" data-testid="cvv-input" {...register('cvv')} />
          {errors.cvv !== undefined && (
            <span className="error" data-testid="cvv-error">
              {errors.cvv.message}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="amount">Amount (USD)</label>
          <input
            id="amount"
            type="number"
            step="0.01"
            data-testid="amount-input"
            {...register('amount')}
          />
          {errors.amount !== undefined && (
            <span className="error" data-testid="amount-error">
              {errors.amount.message}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={status === 'submitting'}
          data-testid="checkout-submit"
        >
          {status === 'submitting' ? 'Submitting…' : 'Pay'}
        </button>
      </form>
    </div>
  );
}
