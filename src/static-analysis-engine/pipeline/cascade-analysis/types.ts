import type { AnalysisConfidence, AnalysisSeverity, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { RenderedElementId } from "../render-structure/index.js";
import type { ProjectEvidenceId } from "../project-evidence/index.js";

export type CssSpecificity = {
  a: number;
  b: number;
  c: number;
};

export type CascadeKey = {
  origin: "author" | "inline" | "user" | "user-agent" | "unknown";
  important: boolean;
  layer?: {
    name?: string;
    order?: number;
    known: boolean;
  };
  specificity: CssSpecificity;
  scopeProximity?: {
    distance?: number;
    known: boolean;
  };
  sourceOrder?: number;
  orderKnown: boolean;
};

export type CascadeConditionSource =
  | "at-rule"
  | "selector-state"
  | "render-condition"
  | "class-emission-condition"
  | "runtime-css-loading";

export type CascadeConditionSet = {
  id: string;
  sources: CascadeConditionSource[];
  atRuleContext: Array<{ name: string; params: string }>;
  renderConditionIds: string[];
  classEmissionConditionIds: string[];
  pseudoStates: string[];
  runtimeContextIds: string[];
  compatibility: "definite" | "conditional" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type CascadeDeclarationCandidate = {
  id: string;
  declarationId: ProjectEvidenceId;
  elementId: RenderedElementId;
  selectorBranchId?: ProjectEvidenceId;
  property: string;
  cascadeKey: CascadeKey;
  conditionSetId?: string;
  matchCertainty: "definite" | "possible" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};

export type CascadeComparisonReason =
  | "higher-origin"
  | "important"
  | "layer-order"
  | "specificity"
  | "scope-proximity"
  | "source-order"
  | "condition-uncertain"
  | "order-uncertain"
  | "unsupported-selector"
  | "unsupported-property-semantics";

export type CascadeComparisonStep = {
  reason: CascadeComparisonReason;
  winningCandidateId?: string;
  losingCandidateId?: string;
  certainty: "definite" | "possible" | "unknown";
  detail: string;
};

export type CascadeOutcome = {
  id: string;
  elementId: RenderedElementId;
  property: string;
  winningCandidateId?: string;
  losingCandidateIds: string[];
  unresolvedCandidateIds: string[];
  certainty: "definite" | "possible" | "unknown";
  reason: CascadeComparisonReason;
  comparisonTrace: CascadeComparisonStep[];
  traces: AnalysisTrace[];
};

export type CascadeAnalysisDiagnosticCode =
  | "unsupported-selector-specificity"
  | "unsupported-selector-match"
  | "unknown-stylesheet-order"
  | "unknown-condition-compatibility"
  | "unsupported-property-semantics"
  | "missing-declaration-location"
  | "missing-selector-branch-match";

export type CascadeAnalysisDiagnostic = {
  id: string;
  code: CascadeAnalysisDiagnosticCode;
  severity: AnalysisSeverity;
  confidence: AnalysisConfidence;
  message: string;
  location?: SourceAnchor;
  declarationId?: ProjectEvidenceId;
  selectorBranchId?: ProjectEvidenceId;
  elementId?: RenderedElementId;
  traces: AnalysisTrace[];
};

export type CssDeclarationCascadeRecord = {
  declarationId: ProjectEvidenceId;
  property: string;
  value: string;
  important: boolean;
  cascadeKey: CascadeKey;
};

export type CascadeAnalysisIndexes = {
  declarationRecordById: Map<ProjectEvidenceId, CssDeclarationCascadeRecord>;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  outcomeById: Map<string, CascadeOutcome>;
  conditionSetById: Map<string, CascadeConditionSet>;
  candidateIdsByDeclarationId: Map<ProjectEvidenceId, string[]>;
  candidateIdsBySelectorBranchId: Map<ProjectEvidenceId, string[]>;
  candidateIdsByElementId: Map<RenderedElementId, string[]>;
  candidateIdsByElementAndProperty: Map<string, string[]>;
  candidateIdsByConditionSetId: Map<string, string[]>;
  outcomeIdsByElementId: Map<RenderedElementId, string[]>;
  outcomeIdsByWinningCandidateId: Map<string, string[]>;
  diagnosticIdsByDeclarationId: Map<ProjectEvidenceId, string[]>;
  diagnosticIdsBySelectorBranchId: Map<ProjectEvidenceId, string[]>;
};

export type CascadeAnalysisMeta = {
  generatedAtStage: "cascade-analysis";
  declarationCount: number;
  conditionSetCount: number;
  candidateCount: number;
  outcomeCount: number;
  diagnosticCount: number;
};

export type CascadeAnalysisResult = {
  declarations: CssDeclarationCascadeRecord[];
  conditionSets: CascadeConditionSet[];
  candidates: CascadeDeclarationCandidate[];
  outcomes: CascadeOutcome[];
  diagnostics: CascadeAnalysisDiagnostic[];
  indexes: CascadeAnalysisIndexes;
  meta: CascadeAnalysisMeta;
};
