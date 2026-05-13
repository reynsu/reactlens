import { http, HttpResponse } from 'msw';

type LoginBody = { email: string; password: string };
type CheckoutBody = { cardNumber: string; cvv: string; amount: number };

export const handlers = [
  http.post('/api/login', async ({ request }) => {
    const body = (await request.json()) as LoginBody;
    if (body.email === 'user@example.com' && body.password === 'password123') {
      return HttpResponse.json({ token: 'demo-token' });
    }
    return HttpResponse.json({ message: 'invalid credentials' }, { status: 401 });
  }),

  http.get('/api/orders', () =>
    HttpResponse.json([
      { id: 'A100', total: 49.99, status: 'shipped' },
      { id: 'A101', total: 12.5, status: 'pending' },
    ]),
  ),

  http.post('/api/checkout', async ({ request }) => {
    const body = (await request.json()) as CheckoutBody;
    if (body.cardNumber.startsWith('4000')) {
      return HttpResponse.json({ message: 'declined' }, { status: 402 });
    }
    return HttpResponse.json({ confirmationId: `CONF-${Date.now()}` });
  }),
];
