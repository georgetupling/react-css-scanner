import type { ClassExpressionSummary } from "../symbolic-evaluation/class-values/types.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ModuleFacts, ModuleFactsImportKind } from "../module-facts/types.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type {
  RenderGraphProjectionEdge,
  RenderModel as RenderStructureModel,
  UnsupportedClassReferenceDiagnostic,
} from "../render-structure/types.js";
import type { RuntimeDomLibraryHint } from "../runtime-dom/types.js";
import type { SelectorConstraint, SelectorQueryResult } from "../selector-analysis/types.js";
import type { FactGraphResult } from "../fact-graph/types.js";
import type { SymbolicEvaluationResult } from "../symbolic-evaluation/types.js";
import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type {
  ProjectBindingResolution,
  ResolvedCssModuleBindingDiagnostic,
} from "../symbol-resolution/types.js";
import type {
  CssAtRuleContextFact,
  CssClassContextFact,
  CssClassDefinitionFact,
  CssDeclarationFact,
} from "../../types/css.js";

export type ProjectAnalysisId = string;
export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type ProjectAnalysis = {
  meta: ProjectAnalysisMeta;
  inputs: ProjectAnalysisInputs;
  entities: ProjectAnalysisEntities;
  relations: ProjectAnalysisRelations;
  indexes: ProjectAnalysisIndexes;
};

export type ProjectAnalysisMeta = {
  sourceFileCount: number;
  cssFileCount: number;
  externalCssEnabled: boolean;
};

export type ProjectAnalysisInputs = {
  sourceFiles: SourceFileRecord[];
  cssFiles: CssFileRecord[];
  externalCss: ExternalCssSummary;
};

export type SourceFileRecord = {
  id: ProjectAnalysisId;
  filePath: string;
};

export type CssFileRecord = {
  id: ProjectAnalysisId;
  filePath?: string;
};

export type ProjectAnalysisEntities = {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  staticallySkippedClassReferences: StaticallySkippedClassReferenceAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  classContexts: ClassContextAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  classOwnership: ClassOwnershipAnalysis[];
  components: ComponentAnalysis[];
  renderSubtrees: RenderSubtreeAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
};

export type SourceFileAnalysis = SourceFileRecord & {
  moduleKind: "source";
};

export type StylesheetOrigin = "project-css" | "css-module" | "external-import" | "unknown";

export type ProjectAnalysisStylesheetInput = {
  filePath?: string;
  cssKind: "global-css" | "css-module";
  origin: "project" | "html-linked" | "package" | "remote";
};

export type StylesheetAnalysis = CssFileRecord & {
  origin: StylesheetOrigin;
  definitions: ProjectAnalysisId[];
  selectors: ProjectAnalysisId[];
};

export type ClassReferenceOrigin = "render-ir" | "runtime-dom" | "unknown";

export type ClassReferenceExpressionKind =
  | "exact-string"
  | "string-set"
  | "dynamic"
  | "unsupported";

export type ClassReferenceAnalysis = {
  id: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  suppliedByComponentId?: ProjectAnalysisId;
  emittedByComponentId?: ProjectAnalysisId;
  classNameComponentIds?: Record<string, ProjectAnalysisId>;
  renderSubtreeId?: ProjectAnalysisId;
  location: SourceAnchor;
  emittedElementLocation?: SourceAnchor;
  placementLocation?: SourceAnchor;
  origin: ClassReferenceOrigin;
  runtimeLibraryHint?: RuntimeDomLibraryHint;
  expressionKind: ClassReferenceExpressionKind;
  rawExpressionText: string;
  definiteClassNames: string[];
  possibleClassNames: string[];
  unknownDynamic: boolean;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
  sourceSummary: ClassExpressionSummary;
};

export type StaticallySkippedClassReferenceAnalysis = {
  id: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  renderSubtreeId?: ProjectAnalysisId;
  location: SourceAnchor;
  branchLocation: SourceAnchor;
  conditionSourceText: string;
  skippedBranch: "when-true" | "when-false";
  reason: "condition-resolved-true" | "condition-resolved-false" | "expression-resolved-nullish";
  rawExpressionText: string;
  definiteClassNames: string[];
  possibleClassNames: string[];
  unknownDynamic: boolean;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
  sourceSummary: ClassExpressionSummary;
};

export type ClassDefinitionSelectorKind =
  | "simple-root"
  | "compound"
  | "contextual"
  | "complex"
  | "unsupported";

export type ClassDefinitionAnalysis = {
  id: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  className: string;
  selectorText: string;
  selectorKind: ClassDefinitionSelectorKind;
  line: number;
  atRuleContext: CssAtRuleContextFact[];
  declarationProperties: string[];
  declarationSignature: string;
  isCssModule: boolean;
  sourceDefinition: CssClassDefinitionFact;
};

export type ClassContextAnalysis = {
  id: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  className: string;
  selectorText: string;
  selectorKind: ClassDefinitionSelectorKind;
  line: number;
  atRuleContext: CssAtRuleContextFact[];
  sourceContext: CssClassContextFact;
};

export type SelectorQueryAnalysis = {
  id: ProjectAnalysisId;
  stylesheetId?: ProjectAnalysisId;
  selectorText: string;
  location?: SourceAnchor;
  constraint?: SelectorConstraint | { kind: "unsupported"; reason: string };
  outcome: SelectorQueryResult["outcome"];
  status: SelectorQueryResult["status"];
  confidence: SelectorQueryResult["confidence"];
  traces: AnalysisTrace[];
  sourceResult: SelectorQueryResult;
};

export type SelectorBranchAnalysis = {
  id: ProjectAnalysisId;
  selectorQueryId: ProjectAnalysisId;
  stylesheetId?: ProjectAnalysisId;
  selectorText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  location?: SourceAnchor;
  constraint?: SelectorConstraint | { kind: "unsupported"; reason: string };
  outcome: SelectorQueryResult["outcome"];
  status: SelectorQueryResult["status"];
  confidence: SelectorQueryResult["confidence"];
  traces: AnalysisTrace[];
  sourceQuery: SelectorQueryAnalysis;
};

export type OwnerCandidateReason =
  | "single-importing-component"
  | "single-consuming-component"
  | "same-directory"
  | "sibling-basename-convention"
  | "component-folder-convention"
  | "feature-folder-convention"
  | "multi-consumer"
  | "unknown";

export type OwnerCandidate = {
  kind: "component" | "source-file" | "directory" | "unknown";
  id?: ProjectAnalysisId;
  path?: string;
  confidence: AnalysisConfidence;
  reasons: OwnerCandidateReason[];
  traces: AnalysisTrace[];
};

export type ClassConsumerSummary = {
  classDefinitionId: ProjectAnalysisId;
  className: string;
  consumerComponentIds: ProjectAnalysisId[];
  consumerSourceFileIds: ProjectAnalysisId[];
  referenceIds: ProjectAnalysisId[];
  matchIds: ProjectAnalysisId[];
};

export type ClassOwnershipEvidenceKind =
  | "single-importing-component"
  | "single-consuming-component"
  | "multi-consumer"
  | "path-convention"
  | "unknown";

export type ClassOwnershipAnalysis = {
  id: ProjectAnalysisId;
  classDefinitionId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  className: string;
  consumerSummary: ClassConsumerSummary;
  ownerCandidates: OwnerCandidate[];
  evidenceKind: ClassOwnershipEvidenceKind;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type ComponentAnalysis = {
  id: ProjectAnalysisId;
  componentKey: string;
  filePath: string;
  componentName: string;
  exported: boolean;
  location: SourceAnchor;
};

export type RenderSubtreeAnalysis = {
  id: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  componentKey?: string;
  filePath: string;
  componentName?: string;
  exported: boolean;
  location: SourceAnchor;
  sourceBoundaryId?: string;
};

export type UnsupportedClassReferenceAnalysis = {
  id: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  location: SourceAnchor;
  rawExpressionText: string;
  reason: UnsupportedClassReferenceDiagnostic["reason"];
  traces: AnalysisTrace[];
  sourceDiagnostic: UnsupportedClassReferenceDiagnostic;
};

export type CssModuleImportAnalysis = {
  id: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  importKind: "default" | "namespace" | "named";
};

export type CssModuleMemberReferenceAnalysis = {
  id: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  localName: string;
  memberName: string;
  accessKind: "property" | "string-literal-element" | "destructured-binding";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleAliasAnalysis = {
  id: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  localName: string;
  aliasName: string;
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleDestructuredBindingAnalysis = {
  id: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  localName: string;
  memberName: string;
  bindingName: string;
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleReferenceDiagnosticAnalysis = {
  id: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  localName: string;
  reason: ResolvedCssModuleBindingDiagnostic["reason"];
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ProjectAnalysisRelations = {
  moduleImports: ModuleImportRelation[];
  componentRenders: ComponentRenderRelation[];
  stylesheetReachability: StylesheetReachabilityRelation[];
  referenceMatches: ClassReferenceMatchRelation[];
  selectorMatches: SelectorMatchRelation[];
  providerClassSatisfactions: ProviderClassSatisfactionRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
};

export type ModuleImportRelation = {
  fromSourceFileId: ProjectAnalysisId;
  toModuleId?: string;
  specifier: string;
  importKind: ModuleFactsImportKind;
};

export type ComponentRenderRelation = {
  fromComponentId: ProjectAnalysisId;
  toComponentId?: ProjectAnalysisId;
  renderPath: RenderGraphProjectionEdge["renderPath"];
  resolution: RenderGraphProjectionEdge["resolution"];
  location: SourceAnchor;
  traces: AnalysisTrace[];
};

export type StylesheetReachabilityRelation = {
  stylesheetId: ProjectAnalysisId;
  sourceFileId?: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  availability: ReachabilityAvailability;
  contexts: StylesheetReachabilityContextRecord[];
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ClassReferenceMatchRelation = {
  id: ProjectAnalysisId;
  referenceId: ProjectAnalysisId;
  definitionId: ProjectAnalysisId;
  className: string;
  referenceClassKind: "definite" | "possible";
  reachability: ReachabilityAvailability;
  matchKind: "reachable-stylesheet" | "unreachable-stylesheet";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type SelectorMatchRelation = {
  id: ProjectAnalysisId;
  selectorQueryId: ProjectAnalysisId;
  stylesheetId?: ProjectAnalysisId;
  availability?: ReachabilityAvailability;
  outcome: SelectorQueryResult["outcome"];
  contextCount: number;
  matchedContextCount: number;
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProviderClassSatisfactionRelation = {
  id: ProjectAnalysisId;
  referenceId: ProjectAnalysisId;
  className: string;
  referenceClassKind: "definite" | "possible";
  provider: string;
  reasons: string[];
  traces: AnalysisTrace[];
};

export type CssModuleMemberMatchRelation = {
  id: ProjectAnalysisId;
  referenceId: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  definitionId?: ProjectAnalysisId;
  className: string;
  exportName: string;
  status: "matched" | "missing";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProjectAnalysisIndexes = {
  sourceFilesById: Map<ProjectAnalysisId, SourceFileAnalysis>;
  stylesheetsById: Map<ProjectAnalysisId, StylesheetAnalysis>;
  classReferencesById: Map<ProjectAnalysisId, ClassReferenceAnalysis>;
  staticallySkippedClassReferencesById: Map<
    ProjectAnalysisId,
    StaticallySkippedClassReferenceAnalysis
  >;
  classDefinitionsById: Map<ProjectAnalysisId, ClassDefinitionAnalysis>;
  classContextsById: Map<ProjectAnalysisId, ClassContextAnalysis>;
  selectorQueriesById: Map<ProjectAnalysisId, SelectorQueryAnalysis>;
  selectorBranchesById: Map<ProjectAnalysisId, SelectorBranchAnalysis>;
  classOwnershipById: Map<ProjectAnalysisId, ClassOwnershipAnalysis>;
  componentsById: Map<ProjectAnalysisId, ComponentAnalysis>;
  unsupportedClassReferencesById: Map<ProjectAnalysisId, UnsupportedClassReferenceAnalysis>;
  cssModuleImportsById: Map<ProjectAnalysisId, CssModuleImportAnalysis>;
  cssModuleAliasesById: Map<ProjectAnalysisId, CssModuleAliasAnalysis>;
  cssModuleDestructuredBindingsById: Map<ProjectAnalysisId, CssModuleDestructuredBindingAnalysis>;
  cssModuleMemberReferencesById: Map<ProjectAnalysisId, CssModuleMemberReferenceAnalysis>;
  cssModuleReferenceDiagnosticsById: Map<ProjectAnalysisId, CssModuleReferenceDiagnosticAnalysis>;
  sourceFileIdByPath: Map<string, ProjectAnalysisId>;
  stylesheetIdByPath: Map<string, ProjectAnalysisId>;
  componentIdByFilePathAndName: Map<string, ProjectAnalysisId>;
  componentIdByComponentKey: Map<string, ProjectAnalysisId>;
  definitionsByClassName: Map<string, ProjectAnalysisId[]>;
  definitionsByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  contextsByClassName: Map<string, ProjectAnalysisId[]>;
  contextsByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  referencesByClassName: Map<string, ProjectAnalysisId[]>;
  staticallySkippedReferencesByClassName: Map<string, ProjectAnalysisId[]>;
  referencesBySourceFileId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  reachableStylesheetsBySourceFileId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  reachableStylesheetsByComponentId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  selectorQueriesByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  selectorBranchesByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  selectorBranchesByQueryId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  selectorBranchesByRuleKey: Map<string, ProjectAnalysisId[]>;
  classOwnershipByClassDefinitionId: Map<ProjectAnalysisId, ProjectAnalysisId>;
  classOwnershipByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  classOwnershipByOwnerComponentId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  classOwnershipByConsumerComponentId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  referenceMatchesById: Map<ProjectAnalysisId, ClassReferenceMatchRelation>;
  matchesByReferenceId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  referenceMatchesByReferenceAndClassName: Map<string, ProjectAnalysisId[]>;
  providerSatisfactionsById: Map<ProjectAnalysisId, ProviderClassSatisfactionRelation>;
  providerSatisfactionsByReferenceId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  providerSatisfactionsByReferenceAndClassName: Map<string, ProjectAnalysisId[]>;
  selectorMatchesById: Map<ProjectAnalysisId, SelectorMatchRelation>;
  selectorMatchesByQueryId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleMemberMatchesById: Map<ProjectAnalysisId, CssModuleMemberMatchRelation>;
  cssModuleImportsBySourceFileId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleImportsByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleAliasesByImportId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleDestructuredBindingsByImportId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleMemberReferencesByImportId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleMemberReferencesByStylesheetAndClassName: Map<string, ProjectAnalysisId[]>;
  cssModuleMemberMatchesByReferenceId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleMemberMatchesByDefinitionId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  cssModuleReferenceDiagnosticsByImportId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
};

export type SerializableProjectAnalysis = Omit<ProjectAnalysis, "indexes"> & {
  indexes: SerializableProjectAnalysisIndexes;
};

export type SerializableProjectAnalysisIndexes = {
  [K in keyof ProjectAnalysisIndexes]: Record<string, unknown>;
};

export type ProjectAnalysisBuildInput = {
  moduleFacts: ModuleFacts;
  factGraph?: FactGraphResult;
  cssFiles: import("../css-analysis/types.js").ExperimentalCssFileAnalysis[];
  stylesheets?: ProjectAnalysisStylesheetInput[];
  symbolResolution: ProjectBindingResolution;
  cssModuleLocalsConvention?: CssModuleLocalsConvention;
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: import("../reachability/types.js").ReachabilitySummary;
  renderModel: RenderStructureModel;
  unsupportedClassReferences?: UnsupportedClassReferenceDiagnostic[];
  symbolicEvaluation?: SymbolicEvaluationResult;
  selectorQueryResults: SelectorQueryResult[];
  includeTraces?: boolean;
};

export type DeclarationForSignature = Pick<CssDeclarationFact, "property" | "value">;
