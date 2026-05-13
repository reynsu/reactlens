import { Link, Outlet } from '@tanstack/react-router';

export function App(): JSX.Element {
  return (
    <div className="layout">
      <nav className="nav" data-testid="main-nav">
        <Link to="/login" activeProps={{ className: 'active' }}>Login</Link>
        <Link to="/dashboard" activeProps={{ className: 'active' }}>Dashboard</Link>
        <Link to="/checkout" activeProps={{ className: 'active' }}>Checkout</Link>
      </nav>
      <Outlet />
    </div>
  );
}
