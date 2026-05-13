'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavBar(): JSX.Element {
  const pathname = usePathname();
  const links = [
    { href: '/login', label: 'Login' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/checkout', label: 'Checkout' },
  ];
  return (
    <nav className="nav" data-testid="main-nav">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? 'active' : ''}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
