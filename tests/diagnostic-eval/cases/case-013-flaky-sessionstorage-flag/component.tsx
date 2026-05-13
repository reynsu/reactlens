import { useEffect, useState } from 'react';

type Variant = 'legacy' | 'new';

export function PromoBanner(): JSX.Element {
  const [variant, setVariant] = useState<Variant>('legacy');

  useEffect(() => {
    const flag = sessionStorage.getItem('feature.new-banner');
    if (flag === 'on') setVariant('new');
  }, []);

  if (variant === 'new') {
    return <div data-testid="banner-new">Free shipping over $35 — limited time</div>;
  }
  return <div data-testid="banner-legacy">10% off your first order</div>;
}
