import { NavLink, Outlet } from 'react-router-dom';

export function App(): JSX.Element {
  return (
    <div className="layout">
      <nav className="nav" data-testid="main-nav">
        <NavLink to="/login">Login</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/checkout">Checkout</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
