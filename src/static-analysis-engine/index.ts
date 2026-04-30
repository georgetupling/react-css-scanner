export { analyzeProjectSourceTexts, analyzeSourceText } from "./entry/scan.js";
export { analyzeCssSources } from "./pipeline/css-analysis/index.js";
export {
  buildLanguageFrontends,
  buildSourceFrontendFactsFromSourceFiles,
  buildSourceFrontendFactsFromParsedFiles,
} from "./pipeline/language-frontends/index.js";
export {
  buildFactGraph,
  graphToReachabilityStylesheets,
  graphToReactRenderSyntaxInputs,
  graphToStylesheetFilePaths,
} from "./pipeline/fact-graph/index.js";
export { evaluateSymbolicExpressions } from "./pipeline/symbolic-evaluation/index.js";
export { buildModuleFacts } from "./pipeline/module-facts/buildModuleFacts.js";
export {
  collectAvailableExportedNames,
  getAllResolvedModuleFacts,
  getAnalyzedModuleFilePaths,
  getDirectSourceImportFacts,
  getDirectStylesheetImportFacts,
  getResolvedModuleFacts,
  resolveModuleFactExport,
  resolveModuleFactSourceSpecifier,
  resolveSourceSpecifier,
} from "./pipeline/module-facts/index.js";
export {
  buildProjectBindingResolution,
  collectSourceSymbols,
  createSymbolId,
  getExportedExpressionBindingsForFile,
  getCssModuleBindingsForFile,
  getImportedBindingsForFile,
  getImportedComponentBindingsForFile,
  getImportedExpressionBindingsBySymbolIdForFile,
  getLocalAliasAt,
  getLocalAliasResolutionsForFile,
  getNamespaceImportsForFile,
  getScopeAt,
  getSymbol,
  getSymbolAt,
  getSymbolReferenceAt,
  getSymbolResolutionFilePaths,
  resolveAliasedSymbol,
  resolveLocalAliasAt,
  resolveReferenceAt,
  resolveCssModuleMember,
  resolveCssModuleMemberAccess,
  resolveCssModuleNamespace,
  resolveExportedTypeDeclaration,
  resolveExportedTypeBinding,
  resolveTypeDeclaration,
  resolveTypeBinding,
} from "./pipeline/symbol-resolution/index.js";
export { toAbstractClassSet, toClassExpressionSummary } from "./pipeline/render-model/index.js";
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
  CssClassContextFact,
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
export type {
  AnalysisProgressCallback,
  AnalysisProgressEvent,
  AnalysisProgressStatus,
  StaticAnalysisEngineResult,
} from "./types/runtime.js";
export type { ExperimentalCssFileAnalysis } from "./pipeline/css-analysis/index.js";
export type {
  CssFrontendFacts,
  CssFrontendFile,
  LanguageFrontendsInput,
  LanguageFrontendsResult,
  RuntimeDomClassSite,
  RuntimeDomClassSiteKind,
  RuntimeDomLibraryHint,
  SourceFrontendFacts,
  SourceFrontendFile,
  SourceLanguageKind,
  SourceModuleSyntaxFacts,
} from "./pipeline/language-frontends/index.js";
export type {
  FactEdge,
  FactEdgeId,
  FactGraph,
  FactGraphDiagnostic,
  FactGraphResult,
  FactNode,
  FactNodeId,
  FactProvenance,
  FileResourceNode,
  ContainsEdge,
  DefinesSelectorEdge,
  ModuleNode,
  OriginatesFromFileEdge,
  RuleDefinitionNode,
  SelectorBranchNode,
  SelectorNode,
  StyleSheetNode,
} from "./pipeline/fact-graph/index.js";
export type {
  CanonicalClassExpression,
  CanonicalExpressionKind,
  Certainty,
  ClassEmissionVariant,
  ConditionFact,
  ConditionId,
  CssModuleClassContribution,
  EvaluatedExpressionFacts,
  EvaluatedExpressionId,
  EvaluatedExpressionIndexes,
  ExternalClassContribution,
  SymbolicEvaluationDiagnostic,
  SymbolicEvaluationInput,
  SymbolicEvaluationOptions,
  SymbolicEvaluationProvenance,
  SymbolicEvaluationResult,
  TokenAlternative,
  UnsupportedReason,
  UnsupportedReasonCode,
} from "./pipeline/symbolic-evaluation/index.js";
export type {
  ActiveExternalCssProvider,
  ExternalCssAnalysisInput,
  ExternalCssGlobalProviderConfig,
  ExternalCssSummary,
} from "./pipeline/external-css/index.js";
export type {
  HtmlStylesheetLinkFact,
  HtmlStylesheetLinkInput,
} from "./pipeline/workspace-discovery/index.js";
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
  ModuleFacts,
  ModuleFactsImportKind,
  ResolvedModuleFacts,
} from "./pipeline/module-facts/index.js";
export type {
  EngineSymbol,
  LocalAliasResolution,
  ProjectBindingResolution,
  ScopeId,
  ScopeKind,
  ResolvedCssModuleBindingsForFile,
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleImport,
  ResolvedCssModuleMemberAccessResult,
  ResolvedCssModuleMemberBinding,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
  ResolvedImportedBinding,
  ResolvedNamespaceMemberResult,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
  ResolvedTypeDeclaration,
  ResolvedTypeBinding,
  SourceScope,
  SymbolReference,
  SymbolSpace,
  SymbolResolutionReason,
  SymbolKind,
} from "./pipeline/symbol-resolution/index.js";
export type {
  AbstractClassSet,
  AbstractValue,
  ClassDerivationStep,
  ClassExpressionSummary,
} from "./pipeline/symbolic-evaluation/index.js";
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
  ClassContextAnalysis,
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
  CssModuleLocalsConvention,
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
  SemanticOutcome,
} from "./pipeline/selector-analysis/index.js";
