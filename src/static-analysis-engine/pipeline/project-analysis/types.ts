import type { ClassExpressionSummary } from "../render-model/abstract-values/types.js";
import type { UnsupportedClassReferenceDiagnostic } from "../render-model/class-reference-diagnostics/types.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ModuleImportKind } from "../module-graph/types.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type { RenderGraphEdge } from "../render-model/render-graph/types.js";
import type { RenderSubtree } from "../render-model/render-ir/types.js";
import type { SelectorConstraint, SelectorQueryResult } from "../selector-analysis/types.js";
import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { CssModuleAnalysis } from "../css-modules/types.js";
import type {
  CssAtRuleContextFact,
  CssClassDefinitionFact,
  CssDeclarationFact,
} from "../../types/css.js";

export type ProjectAnalysisId = string;

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
  classDefinitions: ClassDefinitionAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  classOwnership: ClassOwnershipAnalysis[];
  components: ComponentAnalysis[];
  renderSubtrees: RenderSubtreeAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleNamedImportBindings: CssModuleNamedImportBindingAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
};

export type SourceFileAnalysis = SourceFileRecord & {
  moduleKind: "source";
};

export type StylesheetOrigin = "project-css" | "css-module" | "external-import" | "unknown";

export type StylesheetAnalysis = CssFileRecord & {
  origin: StylesheetOrigin;
  definitions: ProjectAnalysisId[];
  selectors: ProjectAnalysisId[];
};

export type ClassReferenceOrigin = "render-ir" | "css-module-member" | "unknown";

export type ClassReferenceExpressionKind =
  | "exact-string"
  | "string-set"
  | "dynamic"
  | "unsupported";

export type ClassReferenceAnalysis = {
  id: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  renderSubtreeId?: ProjectAnalysisId;
  location: SourceAnchor;
  emittedElementLocation?: SourceAnchor;
  placementLocation?: SourceAnchor;
  origin: ClassReferenceOrigin;
  expressionKind: ClassReferenceExpressionKind;
  rawExpressionText: string;
  definiteClassNames: string[];
  possibleClassNames: string[];
  unknownDynamic: boolean;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
  sourceSummary?: ClassExpressionSummary;
  sourceCssModuleMemberReferenceId?: ProjectAnalysisId;
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
  filePath: string;
  componentName: string;
  exported: boolean;
  location: SourceAnchor;
};

export type RenderSubtreeAnalysis = {
  id: ProjectAnalysisId;
  componentId?: ProjectAnalysisId;
  filePath: string;
  componentName?: string;
  exported: boolean;
  location: SourceAnchor;
  sourceSubtree: RenderSubtree;
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
  importedName: string;
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
  accessKind: "property" | "string-literal-element" | "destructured-binding" | "named-import";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleNamedImportBindingAnalysis = {
  id: ProjectAnalysisId;
  importId: ProjectAnalysisId;
  sourceFileId: ProjectAnalysisId;
  stylesheetId: ProjectAnalysisId;
  specifier: string;
  importedName: string;
  localName: string;
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
  reason: import("../css-modules/types.js").CssModuleReferenceDiagnosticRecord["reason"];
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
  importKind: ModuleImportKind;
};

export type ComponentRenderRelation = {
  fromComponentId: ProjectAnalysisId;
  toComponentId?: ProjectAnalysisId;
  renderPath: RenderGraphEdge["renderPath"];
  resolution: RenderGraphEdge["resolution"];
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
  matchKind: "reachable-stylesheet" | "unreachable-stylesheet" | "css-module";
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
  classDefinitionsById: Map<ProjectAnalysisId, ClassDefinitionAnalysis>;
  selectorQueriesById: Map<ProjectAnalysisId, SelectorQueryAnalysis>;
  selectorBranchesById: Map<ProjectAnalysisId, SelectorBranchAnalysis>;
  classOwnershipById: Map<ProjectAnalysisId, ClassOwnershipAnalysis>;
  componentsById: Map<ProjectAnalysisId, ComponentAnalysis>;
  unsupportedClassReferencesById: Map<ProjectAnalysisId, UnsupportedClassReferenceAnalysis>;
  cssModuleImportsById: Map<ProjectAnalysisId, CssModuleImportAnalysis>;
  cssModuleNamedImportBindingsById: Map<ProjectAnalysisId, CssModuleNamedImportBindingAnalysis>;
  cssModuleAliasesById: Map<ProjectAnalysisId, CssModuleAliasAnalysis>;
  cssModuleDestructuredBindingsById: Map<ProjectAnalysisId, CssModuleDestructuredBindingAnalysis>;
  cssModuleMemberReferencesById: Map<ProjectAnalysisId, CssModuleMemberReferenceAnalysis>;
  cssModuleReferenceDiagnosticsById: Map<ProjectAnalysisId, CssModuleReferenceDiagnosticAnalysis>;
  sourceFileIdByPath: Map<string, ProjectAnalysisId>;
  stylesheetIdByPath: Map<string, ProjectAnalysisId>;
  componentIdByFilePathAndName: Map<string, ProjectAnalysisId>;
  definitionsByClassName: Map<string, ProjectAnalysisId[]>;
  definitionsByStylesheetId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
  referencesByClassName: Map<string, ProjectAnalysisId[]>;
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
  cssModuleNamedImportBindingsByImportId: Map<ProjectAnalysisId, ProjectAnalysisId[]>;
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
  moduleGraph: import("../module-graph/types.js").ModuleGraph;
  cssFiles: import("../css-analysis/types.js").ExperimentalCssFileAnalysis[];
  cssModules: CssModuleAnalysis;
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: import("../reachability/types.js").ReachabilitySummary;
  renderGraph: import("../render-model/render-graph/types.js").RenderGraph;
  renderSubtrees: RenderSubtree[];
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
  selectorQueryResults: SelectorQueryResult[];
};

export type DeclarationForSignature = Pick<CssDeclarationFact, "property" | "value">;
