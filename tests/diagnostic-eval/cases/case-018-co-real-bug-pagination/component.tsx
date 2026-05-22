// Real-bug case shaped for the Component-Object Pattern (v0.3 slice 6 / #13).
//
// The bug is in the component: `pageCount` divides `pageSize / total` instead
// of `total / pageSize`, producing zero buttons whenever `pageSize <= total`.
// A POM-style spec that asserts on the rendered DOM count would fail too,
// but the Component-Object spec asserts on the *prop the component received*
// AND the derived count it computed — exactly the kind of assertion the CO
// surface unlocks. The diagnosis agent should classify this as `real-bug`
// because the spec is correct and the component logic is inverted.
type Props = { total: number; pageSize: number };

export function Pagination(props: Props): JSX.Element {
  // BUG: division is inverted. Correct: Math.floor(props.total / props.pageSize).
  const pageCount = Math.floor(props.pageSize / props.total);
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
