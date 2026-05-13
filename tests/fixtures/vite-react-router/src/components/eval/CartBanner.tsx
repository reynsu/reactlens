import { useEffect, useState } from 'react';

type CartItem = { id: string };

export function CartBanner(): JSX.Element {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem('cart');
    if (raw !== null) setItems(JSON.parse(raw));
  }, []);

  if (items.length === 0) return <div data-testid="cart-empty">Your cart is empty</div>;
  return <div data-testid="cart-count">{items.length} items</div>;
}
