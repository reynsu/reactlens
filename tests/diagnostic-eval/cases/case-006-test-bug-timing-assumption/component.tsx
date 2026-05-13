import { useEffect, useState } from 'react';

type User = { id: string; name: string };

export function UserList(): JSX.Element {
  const [users, setUsers] = useState<User[] | null>(null);

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then(setUsers);
  }, []);

  if (users === null) return <div data-testid="user-list-skeleton">…</div>;
  return (
    <ul data-testid="user-list">
      {users.map((u) => (
        <li key={u.id} data-testid={`user-${u.id}`}>
          {u.name}
        </li>
      ))}
    </ul>
  );
}
