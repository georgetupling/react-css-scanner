import type { ClassExpressionSummary } from "../symbolic-evaluation/class-values/types.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ModuleFacts, ModuleFactsImportKind } from "../module-facts/types.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type {
  RenderGraphProjectionEdge,
  RenderModel,
  UnsupportedClassReferenceDiagnostic,
} from "../render-structure/types.js";
import type { RuntimeDomLibraryHint } from "../language-frontends/types.js";
import type { SelectorConstraint, SelectorQueryResult } from "../selector-analysis/types.js";
import type { SelectorReachabilityResult } from "../selector-reachability/types.js";
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

export type ProjectEvidenceId = string;
export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type SourceFileRecord = {
  id: ProjectEvidenceId;
  filePath: string;
};

export type CssFileRecord = {
  id: ProjectEvidenceId;
  filePath?: string;
};

export type SourceFileAnalysis = SourceFileRecord & {
  moduleKind: "source";
};

export type StylesheetOrigin = "project-css" | "css-module" | "external-import" | "unknown";

export type ProjectEvidenceStylesheetInput = {
  filePath?: string;
  cssKind: "global-css" | "css-module";
  origin: "project" | "html-linked" | "package" | "remote";
};

export type StylesheetAnalysis = CssFileRecord & {
  origin: StylesheetOrigin;
  definitions: ProjectEvidenceId[];
  selectors: ProjectEvidenceId[];
};

export type ClassReferenceOrigin = "render-ir" | "runtime-dom" | "unknown";

export type ClassReferenceExpressionKind =
  | "exact-string"
  | "string-set"
  | "dynamic"
  | "unsupported";

export type ClassReferenceAnalysis = {
  id: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  componentId?: ProjectEvidenceId;
  suppliedByComponentId?: ProjectEvidenceId;
  emittedByComponentId?: ProjectEvidenceId;
  classNameComponentIds?: Record<string, ProjectEvidenceId>;
  renderSubtreeId?: ProjectEvidenceId;
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
  id: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  componentId?: ProjectEvidenceId;
  renderSubtreeId?: ProjectEvidenceId;
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
  id: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
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
  id: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  className: string;
  selectorText: string;
  selectorKind: ClassDefinitionSelectorKind;
  line: number;
  atRuleContext: CssAtRuleContextFact[];
  sourceContext: CssClassContextFact;
};

export type SelectorQueryAnalysis = {
  id: ProjectEvidenceId;
  stylesheetId?: ProjectEvidenceId;
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
  id: ProjectEvidenceId;
  selectorQueryId: ProjectEvidenceId;
  stylesheetId?: ProjectEvidenceId;
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

export type ComponentAnalysis = {
  id: ProjectEvidenceId;
  componentKey: string;
  filePath: string;
  componentName: string;
  exported: boolean;
  location: SourceAnchor;
};

export type RenderSubtreeAnalysis = {
  id: ProjectEvidenceId;
  componentId?: ProjectEvidenceId;
  componentKey?: string;
  filePath: string;
  componentName?: string;
  exported: boolean;
  location: SourceAnchor;
  sourceBoundaryId?: string;
};

export type UnsupportedClassReferenceAnalysis = {
  id: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  location: SourceAnchor;
  rawExpressionText: string;
  reason: UnsupportedClassReferenceDiagnostic["reason"];
  traces: AnalysisTrace[];
  sourceDiagnostic: UnsupportedClassReferenceDiagnostic;
};

export type CssModuleImportAnalysis = {
  id: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  importKind: "default" | "namespace" | "named";
};

export type CssModuleMemberReferenceAnalysis = {
  id: ProjectEvidenceId;
  importId: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  localName: string;
  memberName: string;
  accessKind: "property" | "string-literal-element" | "destructured-binding";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleAliasAnalysis = {
  id: ProjectEvidenceId;
  importId: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  localName: string;
  aliasName: string;
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleDestructuredBindingAnalysis = {
  id: ProjectEvidenceId;
  importId: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  localName: string;
  memberName: string;
  bindingName: string;
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type CssModuleReferenceDiagnosticAnalysis = {
  id: ProjectEvidenceId;
  importId: ProjectEvidenceId;
  sourceFileId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  localName: string;
  reason: ResolvedCssModuleBindingDiagnostic["reason"];
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ModuleImportRelation = {
  fromSourceFileId: ProjectEvidenceId;
  toModuleId?: string;
  resolvedFilePath?: string;
  specifier: string;
  importKind: ModuleFactsImportKind;
};

export type ComponentRenderRelation = {
  fromComponentId: ProjectEvidenceId;
  toComponentId?: ProjectEvidenceId;
  renderPath: RenderGraphProjectionEdge["renderPath"];
  resolution: RenderGraphProjectionEdge["resolution"];
  location: SourceAnchor;
  traces: AnalysisTrace[];
};

export type StylesheetReachabilityRelation = {
  stylesheetId: ProjectEvidenceId;
  sourceFileId?: ProjectEvidenceId;
  componentId?: ProjectEvidenceId;
  availability: ReachabilityAvailability;
  contexts: StylesheetReachabilityContextRecord[];
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ClassReferenceMatchRelation = {
  id: ProjectEvidenceId;
  referenceId: ProjectEvidenceId;
  definitionId: ProjectEvidenceId;
  className: string;
  referenceClassKind: "definite" | "possible";
  reachability: ReachabilityAvailability;
  matchKind: "reachable-stylesheet" | "unreachable-stylesheet";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type SelectorMatchRelation = {
  id: ProjectEvidenceId;
  selectorQueryId: ProjectEvidenceId;
  stylesheetId?: ProjectEvidenceId;
  availability?: ReachabilityAvailability;
  outcome: SelectorQueryResult["outcome"];
  contextCount: number;
  matchedContextCount: number;
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProviderClassSatisfactionRelation = {
  id: ProjectEvidenceId;
  referenceId: ProjectEvidenceId;
  className: string;
  referenceClassKind: "definite" | "possible";
  provider: string;
  reasons: string[];
  traces: AnalysisTrace[];
};

export type CssModuleMemberMatchRelation = {
  id: ProjectEvidenceId;
  referenceId: ProjectEvidenceId;
  importId: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  definitionId?: ProjectEvidenceId;
  className: string;
  exportName: string;
  status: "matched" | "missing";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProjectEvidenceBuilderIndexes = {
  sourceFilesById: Map<ProjectEvidenceId, SourceFileAnalysis>;
  stylesheetsById: Map<ProjectEvidenceId, StylesheetAnalysis>;
  classReferencesById: Map<ProjectEvidenceId, ClassReferenceAnalysis>;
  staticallySkippedClassReferencesById: Map<
    ProjectEvidenceId,
    StaticallySkippedClassReferenceAnalysis
  >;
  classDefinitionsById: Map<ProjectEvidenceId, ClassDefinitionAnalysis>;
  classContextsById: Map<ProjectEvidenceId, ClassContextAnalysis>;
  selectorQueriesById: Map<ProjectEvidenceId, SelectorQueryAnalysis>;
  selectorBranchesById: Map<ProjectEvidenceId, SelectorBranchAnalysis>;
  componentsById: Map<ProjectEvidenceId, ComponentAnalysis>;
  unsupportedClassReferencesById: Map<ProjectEvidenceId, UnsupportedClassReferenceAnalysis>;
  cssModuleImportsById: Map<ProjectEvidenceId, CssModuleImportAnalysis>;
  cssModuleAliasesById: Map<ProjectEvidenceId, CssModuleAliasAnalysis>;
  cssModuleDestructuredBindingsById: Map<ProjectEvidenceId, CssModuleDestructuredBindingAnalysis>;
  cssModuleMemberReferencesById: Map<ProjectEvidenceId, CssModuleMemberReferenceAnalysis>;
  cssModuleReferenceDiagnosticsById: Map<ProjectEvidenceId, CssModuleReferenceDiagnosticAnalysis>;
  sourceFileIdByPath: Map<string, ProjectEvidenceId>;
  stylesheetIdByPath: Map<string, ProjectEvidenceId>;
  componentIdByFilePathAndName: Map<string, ProjectEvidenceId>;
  componentIdByComponentKey: Map<string, ProjectEvidenceId>;
  definitionsByClassName: Map<string, ProjectEvidenceId[]>;
  definitionsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  contextsByClassName: Map<string, ProjectEvidenceId[]>;
  contextsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  referencesByClassName: Map<string, ProjectEvidenceId[]>;
  staticallySkippedReferencesByClassName: Map<string, ProjectEvidenceId[]>;
  referencesBySourceFileId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  reachableStylesheetsBySourceFileId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  reachableStylesheetsByComponentId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  selectorQueriesByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  selectorBranchesByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  selectorBranchesByQueryId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  selectorBranchesByRuleKey: Map<string, ProjectEvidenceId[]>;
  cssModuleImportsBySourceFileId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  cssModuleImportsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  cssModuleAliasesByImportId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  cssModuleDestructuredBindingsByImportId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  cssModuleMemberReferencesByImportId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  cssModuleMemberReferencesByStylesheetAndClassName: Map<string, ProjectEvidenceId[]>;
  cssModuleReferenceDiagnosticsByImportId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
};

export type ProjectEvidenceBuildInput = {
  moduleFacts: ModuleFacts;
  factGraph?: FactGraphResult;
  cssFiles: import("../css-analysis/types.js").ExperimentalCssFileAnalysis[];
  stylesheets?: ProjectEvidenceStylesheetInput[];
  symbolResolution: ProjectBindingResolution;
  cssModuleLocalsConvention?: CssModuleLocalsConvention;
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: import("../reachability/types.js").ReachabilitySummary;
  renderModel: RenderModel;
  unsupportedClassReferences?: UnsupportedClassReferenceDiagnostic[];
  symbolicEvaluation?: SymbolicEvaluationResult;
  selectorReachability?: SelectorReachabilityResult;
  selectorQueryResults: SelectorQueryResult[];
  includeTraces?: boolean;
};

export type DeclarationForSignature = Pick<CssDeclarationFact, "property" | "value">;
