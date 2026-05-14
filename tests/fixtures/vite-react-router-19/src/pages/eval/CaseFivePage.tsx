import { useSearchParams } from 'react-router-dom';
import { Pagination } from '../../components/eval/Pagination';

// Eval-fixture wrapper: reads total/pageSize from the URL so the same page can
// reproduce different case-005 scenarios. Default values reproduce the
// canonical bug scenario (11 items, page size 5 → expected 3 pages, actual 2).
export function CaseFivePage(): JSX.Element {
  const [params] = useSearchParams();
  const total = Number(params.get('total') ?? 11);
  const pageSize = Number(params.get('pageSize') ?? 5);
  return <Pagination total={total} pageSize={pageSize} />;
}
