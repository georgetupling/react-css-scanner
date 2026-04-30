import type { AnalysisConfidence, AnalysisSeverity, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type {
  LegacyAstExpressionStore,
  LegacyParsedProjectFile,
} from "./adapters/legacyAstExpressionStore.js";
import type {
  LegacyRenderModelClassExpressionSummaryRecord,
  LegacyRenderModelClassExpressionSummaryStore,
} from "./adapters/legacyRenderModelAdapter.js";
import type {
  ClassExpressionSiteNode,
  ExpressionSyntaxNode,
  FactGraph,
  FactNodeId,
} from "../fact-graph/index.js";

export type EvaluatedExpressionId = string;
export type ConditionId = string;

export type SymbolicEvaluationOptions = {
  includeTraces?: boolean;
  maxExpressionDepth?: number;
  maxStringCombinations?: number;
  maxEmissionVariants?: number;
  maxHelperExpansionDepth?: number;
};

export type SymbolicEvaluationInput = {
  graph: FactGraph;
  options?: SymbolicEvaluationOptions;
  legacy?: {
    parsedFiles?: LegacyParsedProjectFile[];
    renderModelClassExpressionSummaries?: LegacyRenderModelClassExpressionSummaryRecord[];
  };
  evaluatorRegistry?: SymbolicEvaluatorRegistry;
};

export type SymbolicEvaluationResult = {
  graph: FactGraph;
  evaluatedExpressions: EvaluatedExpressionFacts;
};

export type EvaluatedExpressionFacts = {
  meta: {
    generatedAtStage: "symbolic-evaluation";
    classExpressionSiteCount: number;
    evaluatedClassExpressionCount: number;
    diagnosticCount: number;
  };
  classExpressions: CanonicalClassExpression[];
  conditions: ConditionFact[];
  diagnostics: SymbolicEvaluationDiagnostic[];
  indexes: EvaluatedExpressionIndexes;
};

export type CanonicalExpressionKind =
  | "exact-string"
  | "bounded-string-set"
  | "class-token-set"
  | "css-module-class"
  | "external-contribution"
  | "partial"
  | "unknown";

export type Certainty =
  | { kind: "exact"; summary: "one complete token set" }
  | { kind: "bounded"; summary: "finite complete alternatives"; alternativeCount: number }
  | { kind: "partial"; summary: "some known tokens plus unknown or external input" }
  | { kind: "unknown"; summary: "no reliable token information" };

export type CanonicalClassExpression = {
  id: EvaluatedExpressionId;
  classExpressionSiteNodeId: FactNodeId;
  classExpressionSiteKind: ClassExpressionSiteNode["classExpressionSiteKind"];
  expressionNodeId: FactNodeId;
  sourceExpressionKind?: string;
  filePath: string;
  location: SourceAnchor;
  rawExpressionText: string;
  expressionKind: CanonicalExpressionKind;
  certainty: Certainty;
  confidence: AnalysisConfidence;
  tokens: TokenAlternative[];
  emissionVariants: ClassEmissionVariant[];
  externalContributions: ExternalClassContribution[];
  cssModuleContributions: CssModuleClassContribution[];
  unsupported: UnsupportedReason[];
  tokenAnchors: Record<string, SourceAnchor[]>;
  emittingComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  renderSiteNodeId?: FactNodeId;
  elementTemplateNodeId?: FactNodeId;
  provenance: SymbolicEvaluationProvenance[];
  traces: AnalysisTrace[];
};

export type TokenAlternative = {
  id: EvaluatedExpressionId;
  token: string;
  tokenKind: "global-class" | "css-module-export" | "external-class";
  presence: "always" | "conditional" | "possible";
  conditionId: ConditionId;
  exclusiveGroupId?: string;
  sourceAnchor?: SourceAnchor;
  confidence: AnalysisConfidence;
  contributionId?: string;
};

export type ClassEmissionVariant = {
  id: EvaluatedExpressionId;
  conditionId: ConditionId;
  tokens: string[];
  completeness: "complete" | "partial";
  unknownDynamic: boolean;
};

export type ConditionFact = {
  id: ConditionId;
  kind: "always" | "never" | "truthy" | "falsy" | "and" | "or" | "not" | "unknown";
  sourceText?: string;
  sourceAnchor?: SourceAnchor;
  operands?: ConditionId[];
  confidence: AnalysisConfidence;
};

export type ExternalClassContribution = {
  id: string;
  contributionKind:
    | "component-prop"
    | "helper-parameter"
    | "object-member"
    | "children-prop"
    | "unknown-external";
  localName?: string;
  propertyName?: string;
  sourceAnchor: SourceAnchor;
  conditionId: ConditionId;
  confidence: AnalysisConfidence;
  reason: string;
};

export type CssModuleClassContribution = {
  id: string;
  stylesheetNodeId?: FactNodeId;
  stylesheetFilePath?: string;
  localName: string;
  originLocalName: string;
  exportName: string;
  accessKind: "property" | "string-literal-element" | "destructured-binding";
  conditionId: ConditionId;
  sourceAnchor: SourceAnchor;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type UnsupportedReason = {
  id: string;
  kind:
    | "unsupported-syntax"
    | "unresolved-binding"
    | "dynamic-value"
    | "budget-exceeded"
    | "cycle"
    | "unsafe-operation"
    | "unsupported-helper"
    | "unsupported-css-module-access";
  code: UnsupportedReasonCode;
  message: string;
  sourceAnchor?: SourceAnchor;
  recoverability: "partial" | "none";
  confidence: AnalysisConfidence;
};

export type UnsupportedReasonCode =
  | "unsupported-expression-kind"
  | "unsupported-template-interpolation"
  | "string-concatenation-budget-exceeded"
  | "template-interpolation-budget-exceeded"
  | "emission-variant-budget-exceeded"
  | "class-name-resolution-budget-exceeded"
  | "class-name-resolution-cycle"
  | "unsupported-string-concatenation"
  | "unsupported-call"
  | "unsupported-helper-call"
  | "unsupported-helper-arguments"
  | "unsupported-array-spread"
  | "unsupported-array-hole"
  | "unsupported-array-callback"
  | "unsupported-join-separator"
  | "non-whitespace-join-separator"
  | "unresolved-identifier"
  | "unresolved-member-access"
  | "computed-css-module-member"
  | "computed-css-module-destructuring"
  | "nested-css-module-destructuring"
  | "rest-css-module-destructuring";

export type SymbolicEvaluationProvenance = {
  stage: "symbolic-evaluation";
  filePath?: string;
  anchor?: SourceAnchor;
  upstreamId?: string;
  summary: string;
  traces?: AnalysisTrace[];
};

export type EvaluatedExpressionIndexes = {
  classExpressionById: Map<EvaluatedExpressionId, CanonicalClassExpression>;
  classExpressionIdBySiteNodeId: Map<FactNodeId, EvaluatedExpressionId>;
  classExpressionIdsByFilePath: Map<string, EvaluatedExpressionId[]>;
  classExpressionIdsByComponentNodeId: Map<FactNodeId, EvaluatedExpressionId[]>;
  tokenAlternativeIdsByToken: Map<string, EvaluatedExpressionId[]>;
  cssModuleContributionIdsByStylesheetNodeId: Map<FactNodeId, string[]>;
  cssModuleContributionIdsByExportName: Map<string, string[]>;
  externalContributionIdsByClassExpressionId: Map<EvaluatedExpressionId, string[]>;
  conditionById: Map<ConditionId, ConditionFact>;
  unsupportedReasonIdsByCode: Map<UnsupportedReasonCode, string[]>;
};

export type SymbolicEvaluationDiagnostic = {
  stage: "symbolic-evaluation";
  severity: AnalysisSeverity;
  code:
    | "missing-expression-syntax"
    | "duplicate-evaluated-expression-id"
    | "unresolved-class-expression-site"
    | "unsupported-expression"
    | "evaluation-budget-exceeded"
    | "evaluation-cycle-detected"
    | "legacy-expression-text-mismatch";
  message: string;
  filePath?: string;
  location?: SourceAnchor;
  classExpressionSiteNodeId?: FactNodeId;
  provenance: SymbolicEvaluationProvenance[];
};

export type SymbolicExpressionEvaluatorInput = {
  graph: FactGraph;
  classExpressionSite: ClassExpressionSiteNode;
  expressionSyntax: ExpressionSyntaxNode;
  options: SymbolicEvaluationOptions;
  legacyExpressionStore?: LegacyAstExpressionStore;
  legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
};

export type SymbolicExpressionEvaluatorResult = {
  expression?: CanonicalClassExpression;
  conditions?: ConditionFact[];
  diagnostics?: SymbolicEvaluationDiagnostic[];
};

export type SymbolicExpressionEvaluator = {
  name: string;
  canEvaluate(input: SymbolicExpressionEvaluatorInput): boolean;
  evaluate(input: SymbolicExpressionEvaluatorInput): SymbolicExpressionEvaluatorResult;
};

export type SymbolicEvaluatorRegistry = {
  evaluate(input: SymbolicExpressionEvaluatorInput): SymbolicExpressionEvaluatorResult;
};
