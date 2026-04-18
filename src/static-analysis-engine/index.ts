export { analyzeSourceText } from "./entry/scan.js";
export { parseSourceFile } from "./pipeline/parse/index.js";
export { buildModuleGraphFromSource, createModuleId } from "./pipeline/module-graph/index.js";
export { collectTopLevelSymbols, createSymbolId } from "./pipeline/symbol-resolution/index.js";
export {
  collectClassExpressionSummaries,
  summarizeClassNameExpression,
  toAbstractClassSet,
} from "./pipeline/abstract-values/index.js";
export { buildSameFileRenderSubtrees } from "./pipeline/render-ir/index.js";
export {
  analyzeSelectorQueries,
  extractSelectorQueriesFromCssText,
} from "./pipeline/selector-analysis/index.js";
export type { EngineModuleId, EngineSymbolId, SourceAnchor } from "./types/core.js";
export type { StaticAnalysisEngineResult } from "./types/runtime.js";
export type {
  ModuleExportEdge,
  ModuleExportRecord,
  ModuleGraph,
  ModuleImportEdge,
  ModuleImportKind,
  ModuleImportRecord,
  ModuleNode,
} from "./pipeline/module-graph/index.js";
export type { EngineSymbol, SymbolKind } from "./pipeline/symbol-resolution/index.js";
export type {
  AbstractClassSet,
  AbstractValue,
  ClassDerivationStep,
  ClassExpressionSummary,
} from "./pipeline/abstract-values/index.js";
export type {
  RenderComponentReferenceNode,
  RenderConditionalNode,
  RenderElementNode,
  RenderFragmentNode,
  RenderNode,
  RenderNodeKind,
  RenderSubtree,
  RenderUnknownNode,
} from "./pipeline/render-ir/index.js";
export type {
  AnalysisConfidence,
  AnalysisStatus,
  ExtractedSelectorQuery,
  SelectorConstraint,
  SelectorQueryResult,
  SelectorSourceInput,
  SemanticOutcome,
} from "./pipeline/selector-analysis/index.js";
