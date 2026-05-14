import { useEffect, useState } from 'react';

type Coupon = { code: string; pctOff: number };

export function CouponWidget(): JSX.Element {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);

  useEffect(() => {
    fetch('/api/coupons')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Coupon[]) => setCoupons(data))
      .catch(() => setCoupons([]));
  }, []);

  if (coupons === null) return <div data-testid="coupons-loading">…</div>;
  if (coupons.length === 0) return <div data-testid="coupons-empty">No coupons available right now.</div>;
  return (
    <ul data-testid="coupons-list">
      {coupons.map((c) => (
        <li key={c.code}>{c.code} — {c.pctOff}% off</li>
      ))}
    </ul>
  );
}
