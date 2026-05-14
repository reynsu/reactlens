import { CartBanner } from '../../components/eval/CartBanner';

// Eval-fixture wrapper for case-009 (flaky/test-ordering). The component
// itself reads cart state from localStorage; the spec controls what's in
// localStorage to reproduce the "fails after another spec leaks state"
// failure mode without needing two coordinated specs.
export function CaseNinePage(): JSX.Element {
  return <CartBanner />;
}
