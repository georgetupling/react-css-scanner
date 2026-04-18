export { analyzeProjectSourceTexts, analyzeSourceText } from "./entry/scan.js";
export { analyzeCssSources } from "./pipeline/css-analysis/index.js";
export { parseSourceFile } from "./pipeline/parse/index.js";
export {
  buildModuleGraphFromSource,
  buildModuleGraphFromSources,
  createModuleId,
} from "./pipeline/module-graph/index.js";
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
export { buildReachabilitySummary } from "./pipeline/reachability/index.js";
export { buildRenderGraph } from "./pipeline/render-graph/index.js";
export { runExperimentalRules } from "./pipeline/rule-execution/index.js";
export {
  compareExperimentalFindings,
  compareExperimentalRuleResults,
  formatExperimentalComparisonReport,
  runExperimentalSelectorPilotAgainstCurrentScanner,
  runExperimentalSelectorPilotForProject,
  runExperimentalSelectorPilotForSource,
  summarizeExperimentalComparison,
  toExperimentalFindings,
} from "./comparison/index.js";
export type { EngineModuleId, EngineSymbolId, SourceAnchor } from "./types/core.js";
export type { StaticAnalysisEngineResult } from "./types/runtime.js";
export type { ExperimentalCssFileAnalysis } from "./pipeline/css-analysis/index.js";
export type {
  RenderGraph,
  RenderGraphEdge,
  RenderGraphNode,
} from "./pipeline/render-graph/index.js";
export type {
  ReachabilityAvailability,
  ReachabilitySummary,
  StylesheetReachabilityRecord,
} from "./pipeline/reachability/index.js";
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
  RenderRepeatedRegionNode,
  RenderSubtree,
  RenderUnknownNode,
} from "./pipeline/render-ir/index.js";
export type {
  ExperimentalRuleId,
  ExperimentalRuleResult,
  ExperimentalRuleSeverity,
} from "./pipeline/rule-execution/index.js";
export type {
  ExperimentalFindingComparison,
  ExperimentalFindingComparisonSummary,
  ExperimentalFindingLike,
  ExperimentalRuleComparisonResult,
  ExperimentalSelectorPilotArtifact,
  ExperimentalSelectorPilotShadowArtifact,
} from "./comparison/index.js";
export type {
  AnalysisConfidence,
  AnalysisStatus,
  ExtractedSelectorQuery,
  SelectorConstraint,
  SelectorQueryResult,
  SelectorSourceInput,
  SemanticOutcome,
} from "./pipeline/selector-analysis/index.js";
