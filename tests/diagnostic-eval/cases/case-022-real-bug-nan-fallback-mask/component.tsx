// Synthetic moat-validation case (Type A: silent fallback masks bad prop).
//
// The bug is a calculation that produces NaN when one specific input edge
// case fires. A downstream <DiscountBadge> has a defensive isNaN fallback
// that silently renders "Saved $0" — visually indistinguishable from "no
// discount applied," which is a legitimate product state.
//
// What a black-box (DOM-only) tool sees on test failure:
//   "Expected 'Saved $5', got 'Saved $0'."
// Plausible hypotheses without component-tree info: discount calculation
// broken, prop never reached badge, badge formatter wrong, CSS hiding it,
// MSW mock returning wrong shape, etc. — many candidates, none decisive.
//
// What a component-tree-aware tool sees: the badge's `amount` prop is
// literally NaN. Diagnosis is one step away (find where the calculation
// returned NaN) and the patch is a one-liner.

import * as React from 'react';

type CartItem = { id: string; price: number };

// Bug lives here. The discount is "percent off after coupon," computed as
// percentOff / 100 * subtotal. When the coupon code has a fractional
// percentOff stored as a string that fails to parse (e.g. "ten%"), the
// parseFloat returns NaN. The `?? 0` below LOOKS defensive but does
// nothing for NaN — nullish-coalescing only catches null/undefined.
// So the NaN escapes into the badge prop.
function useDiscountCalculation(cart: CartItem[], couponPercent: string | undefined) {
  const subtotal = cart.reduce((s, i) => s + i.price, 0);
  const percent = parseFloat(couponPercent ?? '0');
  const amount = ((percent / 100) * subtotal) ?? 0;
  return { amount };
}

function DiscountBadge({ amount }: { amount: number }): JSX.Element {
  // Defensive fallback: if calculation upstream blew up, don't crash —
  // show "$0" so the page still renders. Trade-off: makes upstream NaN
  // invisible from the DOM. This is the exact pattern the moat exposes.
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
