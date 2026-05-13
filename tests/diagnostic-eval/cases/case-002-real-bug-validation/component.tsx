import { useState } from 'react';

export function CheckoutPage(): JSX.Element {
  const [cvv, setCvv] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const cvvValid = cvv.length >= 5;

  function onSubmit(): void {
    if (cvvValid) setSubmitted(true);
  }

  return (
    <div data-testid="checkout-card">
      <input
        data-testid="cvv-input"
        value={cvv}
        onChange={(e) => setCvv(e.target.value)}
      />
      <button data-testid="checkout-submit" onClick={onSubmit}>
        Pay
      </button>
      {submitted ? (
        <div data-testid="checkout-success">payment authorised</div>
      ) : (
        cvv.length > 0 &&
        !cvvValid && <div data-testid="cvv-error">cvv too short</div>
      )}
    </div>
  );
}
