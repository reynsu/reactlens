type Props = { total: number; pageSize: number };

export function Pagination(props: Props): JSX.Element {
  const pageCount = Math.floor(props.total / props.pageSize);
  return (
    <nav data-testid="pagination">
      {Array.from({ length: pageCount }, (_, i) => (
        <button key={i} data-testid={`page-${i + 1}`}>
          {i + 1}
        </button>
      ))}
    </nav>
  );
}
