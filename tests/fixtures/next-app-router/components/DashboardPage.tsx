'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchOrders, type Order } from '@/lib/api-client';

export function DashboardPage(): JSX.Element {
  const query = useQuery<Order[], Error>({
    queryKey: ['orders'],
    queryFn: fetchOrders,
  });

  if (query.isLoading) {
    return (
      <div className="card" data-testid="dashboard-loading">
        <span className="spinner">Loading orders</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="card" data-testid="dashboard-error">
        <div className="banner error" role="alert">
          Could not load orders: {query.error.message}
        </div>
        <button onClick={(): void => void query.refetch()} data-testid="dashboard-retry">
          Retry
        </button>
      </div>
    );
  }

  const orders = query.data ?? [];
  if (orders.length === 0) {
    return (
      <div className="card" data-testid="dashboard-empty">
        <div className="empty">No orders yet. Place one in checkout.</div>
      </div>
    );
  }

  return (
    <div data-testid="dashboard-success">
      {orders.map((order) => (
        <div className="card" key={order.id} data-testid={`order-${order.id}`}>
          <strong>Order #{order.id}</strong>
          <div>Total: ${order.total.toFixed(2)}</div>
          <div>Status: {order.status}</div>
        </div>
      ))}
    </div>
  );
}
