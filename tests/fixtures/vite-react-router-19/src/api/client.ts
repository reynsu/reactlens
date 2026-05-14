export type Order = {
  id: string;
  total: number;
  status: 'pending' | 'shipped' | 'delivered';
};

export type CheckoutResult = { confirmationId: string };

export class CheckoutError extends Error {
  readonly code: 'declined' | 'network';
  constructor(message: string, code: 'declined' | 'network') {
    super(message);
    this.code = code;
  }
}

export async function login(email: string, password: string): Promise<{ token: string }> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'invalid credentials');
  }
  return (await res.json()) as { token: string };
}

export async function fetchOrders(): Promise<Order[]> {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Order[];
}

export async function submitCheckout(input: {
  cardNumber: string;
  cvv: string;
  amount: number;
}): Promise<CheckoutResult> {
  let res: Response;
  try {
    res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new CheckoutError('network', 'network');
  }
  if (res.status === 402) {
    throw new CheckoutError('declined', 'declined');
  }
  if (!res.ok) {
    throw new CheckoutError(`HTTP ${res.status}`, 'network');
  }
  return (await res.json()) as CheckoutResult;
}
