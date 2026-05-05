import type { ClassExpressionSummary } from "../symbolic-evaluation/class-values/types.js";
import type {
  RenderGraphProjectionEdge,
  RenderModel,
  UnsupportedClassReferenceDiagnostic,
} from "../render-structure/types.js";
import type { RuntimeDomLibraryHint } from "../language-frontends/types.js";
import type {
  SelectorReachabilityResult,
  SelectorReachabilityStatus,
} from "../selector-reachability/index.js";
import type { FactGraphResult } from "../fact-graph/types.js";
import type { SymbolicEvaluationResult } from "../symbolic-evaluation/types.js";
import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { ResolvedCssModuleBindingDiagnosticReason } from "../language-frontends/source/css-module-syntax/types.js";
import type {
  CssAtRuleContextFact,
  CssClassContextFact,
  CssClassDefinitionFact,
  CssDeclarationFact,
  CssStyleRuleFact,
} from "../../types/css.js";

export type ProjectEvidenceId = string;
export type CssModuleLocalsConvention = "asIs" | "camelCase" | "camelCaseOnly";

export type ProjectImportKind = "source" | "css" | "external-css" | "type-only" | "unknown";

export type ExperimentalCssFileAnalysis = {
  filePath?: string;
  styleRules: CssStyleRuleFact[];
  classDefinitions: CssClassDefinitionFact[];
  classContexts: CssClassContextFact[];
  atRuleContexts: CssAtRuleContextFact[][];
};

export type ReachabilityAvailability = "definite" | "possible" | "unknown" | "unavailable";

export type StylesheetReachabilityContextRecord = {
  context:
    | { kind: "source-file"; filePath: string }
    | { kind: "component"; filePath: string; componentKey?: string; componentName: string }
    | {
        kind: "render-subtree-root";
        filePath: string;
        componentKey?: string;
        componentName?: string;
        rootAnchor: {
          startLine: number;
          startColumn: number;
          endLine?: number;
          endColumn?: number;
        };
      }
    | {
        kind: "render-region";
        filePath: string;
        componentKey?: string;
        componentName?: string;
        regionKind: "subtree-root" | "conditional-branch" | "repeated-template" | "unknown-barrier";
        path: Array<
          | { kind: "root" }
          | { kind: "fragment-child"; childIndex: number }
          | { kind: "conditional-branch"; branch: "when-true" | "when-false" }
          | { kind: "repeated-template" }
        >;
        sourceAnchor: {
          startLine: number;
          startColumn: number;
          endLine?: number;
          endColumn?: number;
        };
      };
  availability: ReachabilityAvailability;
  reasons: string[];
  derivations: Array<
    | { kind: "source-file-direct-import" }
    | { kind: "source-file-entry-bundle"; entrySourceFilePath: string; htmlFilePath?: string }
    | { kind: "source-file-project-wide-external-css"; stylesheetHref: string }
    | { kind: "whole-component-direct-import" }
  >;
  traces: AnalysisTrace[];
};

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
  selectorNodeId?: string;
  ruleDefinitionNodeId?: string;
  stylesheetNodeId?: string;
  selectorReachabilityStatus: SelectorReachabilityStatus;
  selectorReachabilityStatuses: SelectorReachabilityStatus[];
  reasons: string[];
  scopedReachability?: {
    availability: ReachabilityAvailability;
    contextCount: number;
    matchedContextCount: number;
    reasons: string[];
  };
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type SelectorBranchAnalysis = {
  id: ProjectEvidenceId;
  selectorQueryId: ProjectEvidenceId;
  selectorBranchNodeId: string;
  selectorNodeId?: string;
  ruleDefinitionNodeId?: string;
  stylesheetNodeId?: string;
  stylesheetId?: ProjectEvidenceId;
  selectorText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  location?: SourceAnchor;
  selectorReachabilityStatus: SelectorReachabilityStatus;
  reasons: string[];
  scopedReachability?: {
    availability: ReachabilityAvailability;
    contextCount: number;
    matchedContextCount: number;
    reasons: string[];
  };
  confidence: AnalysisConfidence;
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
  reason: ResolvedCssModuleBindingDiagnosticReason;
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ModuleImportRelation = {
  fromSourceFileId: ProjectEvidenceId;
  toModuleId?: string;
  resolvedFilePath?: string;
  specifier: string;
  importKind: ProjectImportKind;
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
  selectorReachabilityStatus: SelectorReachabilityStatus;
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

export type ProviderBackedStylesheetRelation = {
  id: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
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
  factGraph: FactGraphResult;
  stylesheets?: ProjectEvidenceStylesheetInput[];
  cssModuleLocalsConvention?: CssModuleLocalsConvention;
  renderModel: RenderModel;
  unsupportedClassReferences?: UnsupportedClassReferenceDiagnostic[];
  symbolicEvaluation?: SymbolicEvaluationResult;
  selectorReachability?: SelectorReachabilityResult;
  includeTraces?: boolean;
};

export type DeclarationForSignature = Pick<CssDeclarationFact, "property" | "value">;
