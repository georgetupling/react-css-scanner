export { analyzeProjectSourceTexts, analyzeSourceText } from "./entry/scan.js";
export { analyzeCssSources } from "./pipeline/css-analysis/index.js";
export { analyzeCssModules } from "./pipeline/css-modules/index.js";
export { parseSourceFile } from "./pipeline/parse/index.js";
export {
  buildModuleGraphFromSource,
  buildModuleGraphFromSources,
  createModuleId,
} from "./pipeline/module-graph/index.js";
export { collectTopLevelSymbols, createSymbolId } from "./pipeline/symbol-resolution/index.js";
export { summarizeClassNameExpression, toAbstractClassSet } from "./pipeline/render-model/index.js";
export { buildExternalCssSummary } from "./pipeline/external-css/index.js";
export { collectUnsupportedClassReferences } from "./pipeline/render-model/index.js";
export {
  buildSameFileRenderSubtrees,
  collectRenderRegionsFromSubtrees,
} from "./pipeline/render-model/index.js";
export {
  analyzeSelectorQueries,
  extractSelectorQueriesFromCssText,
} from "./pipeline/selector-analysis/index.js";
export { buildReachabilitySummary } from "./pipeline/reachability/index.js";
export { buildRenderGraph, buildRenderModel } from "./pipeline/render-model/index.js";
export {
  buildProjectAnalysis,
  serializeProjectAnalysis,
} from "./pipeline/project-analysis/index.js";
export type { EngineModuleId, EngineSymbolId, SourceAnchor } from "./types/core.js";
export type {
  CssAtRuleContextFact,
  CssClassDefinitionFact,
  CssDeclarationFact,
  CssSelectorBranchFact,
  CssSelectorMatchKind,
  CssStyleRuleFact,
} from "./types/css.js";
export type {
  AnalysisCertainty,
  AnalysisConfidence,
  AnalysisDecision,
  AnalysisDimensionState,
  AnalysisSeverity,
  AnalysisStatus,
  AnalysisTrace,
  AnalysisTraceCategory,
} from "./types/analysis.js";
export { deriveAnalysisConfidence } from "./types/analysis.js";
export type { StaticAnalysisEngineResult } from "./types/runtime.js";
export type { ExperimentalCssFileAnalysis } from "./pipeline/css-analysis/index.js";
export type {
  CssModuleAnalysis,
  CssModuleImportRecord,
  CssModuleMemberReferenceRecord,
  CssModuleReferenceDiagnosticRecord,
} from "./pipeline/css-modules/index.js";
export type {
  ActiveExternalCssProvider,
  ExternalCssAnalysisInput,
  ExternalCssGlobalProviderConfig,
  ExternalCssSourceMode,
  ExternalCssSummary,
  HtmlStylesheetLinkInput,
} from "./pipeline/external-css/index.js";
export type {
  RenderGraph,
  RenderGraphEdge,
  RenderGraphNode,
} from "./pipeline/render-model/render-graph/index.js";
export type {
  ReachabilityAvailability,
  ReachabilitySummary,
  StylesheetReachabilityContext,
  StylesheetReachabilityContextRecord,
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
} from "./pipeline/render-model/abstract-values/index.js";
export type {
  RenderComponentReferenceExpansion,
  RenderComponentReferenceNode,
  RenderConditionalNode,
  RenderElementNode,
  RenderFragmentNode,
  RenderNode,
  RenderNodeKind,
  RenderRepeatedRegionNode,
  RenderRegion,
  RenderRegionKind,
  RenderRegionPathSegment,
  RenderSubtree,
  RenderUnknownNode,
} from "./pipeline/render-model/render-ir/index.js";
export type {
  ClassDefinitionAnalysis,
  ClassDefinitionSelectorKind,
  ClassConsumerSummary,
  ClassOwnershipAnalysis,
  ClassOwnershipEvidenceKind,
  ClassReferenceAnalysis,
  ClassReferenceExpressionKind,
  ClassReferenceMatchRelation,
  ClassReferenceOrigin,
  ComponentAnalysis,
  ComponentRenderRelation,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ModuleImportRelation,
  OwnerCandidate,
  OwnerCandidateReason,
  ProjectAnalysis,
  ProjectAnalysisEntities,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  ProjectAnalysisInputs,
  ProjectAnalysisMeta,
  ProjectAnalysisRelations,
  ProviderClassSatisfactionRelation,
  RenderSubtreeAnalysis,
  SelectorBranchAnalysis,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
  SerializableProjectAnalysis,
  SerializableProjectAnalysisIndexes,
  SourceFileAnalysis,
  StylesheetAnalysis,
  StylesheetOrigin,
  StylesheetReachabilityRelation,
  UnsupportedClassReferenceAnalysis,
} from "./pipeline/project-analysis/index.js";
export type {
  UnsupportedClassReferenceDiagnostic,
  UnsupportedClassReferenceReason,
} from "./pipeline/render-model/class-reference-diagnostics/index.js";
export type {
  ExtractedSelectorQuery,
  SelectorConstraint,
  SelectorQueryResult,
  SelectorSourceInput,
  SemanticOutcome,
} from "./pipeline/selector-analysis/index.js";
