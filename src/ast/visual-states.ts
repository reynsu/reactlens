// Re-export the visual-state extraction surface from component-analyzer so
// consumers can import a stable name even if the analyzer's internals move.
export { analyzeComponent, type ComponentAnalysis, type VisualState } from './component-analyzer';
