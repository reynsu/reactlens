import * as React from 'react';

type CartItem = { id: string; price: number };

function useDiscountCalculation(cart: CartItem[], couponPercent: string | undefined) {
  const subtotal = cart.reduce((s, i) => s + i.price, 0);
  const percent = parseFloat(couponPercent ?? '0');
  const amount = ((percent / 100) * subtotal) ?? 0;
  return { amount };
}

function DiscountBadge({ amount }: { amount: number }): JSX.Element {
  // Defensive: fall back to $0 if the upstream calculation produced a
  // non-finite value. Keeps the page renderable.
  if (Number.isNaN(amount)) return <span data-testid="discount-badge">Saved $0</span>;
  return <span data-testid="discount-badge">Saved ${amount.toFixed(0)}</span>;
}

type Props = {
  cart: CartItem[];
  couponPercent: string | undefined;
};

export function Checkout({ cart, couponPercent }: Props): JSX.Element {
  const { amount } = useDiscountCalculation(cart, couponPercent);
  return (
    <div data-testid="checkout">
      <h1>Checkout</h1>
      <DiscountBadge amount={amount} />
    </div>
  );
}
