import type {
  AnalysisConfidence,
  AnalysisTrace,
  ProjectAnalysis,
  ProjectAnalysisId,
  SourceAnchor,
} from "../static-analysis-engine/index.js";

export type RuleSeverity = "debug" | "info" | "warn" | "error";

export type RuleId =
  | "missing-css-class"
  | "css-class-unreachable"
  | "unused-css-class"
  | "missing-css-module-class"
  | "unused-css-module-class"
  | "unsatisfiable-selector"
  | "compound-selector-never-matched"
  | "unused-compound-selector-branch"
  | "single-component-style-not-colocated"
  | "style-used-outside-owner"
  | "style-shared-without-shared-owner"
  | "dynamic-class-reference"
  | "unsupported-syntax-affecting-analysis";

export type AnalysisEntityRef =
  | { kind: "source-file"; id: ProjectAnalysisId }
  | { kind: "component"; id: ProjectAnalysisId }
  | { kind: "stylesheet"; id: ProjectAnalysisId }
  | { kind: "class-reference"; id: ProjectAnalysisId }
  | { kind: "unsupported-class-reference"; id: ProjectAnalysisId }
  | { kind: "class-definition"; id: ProjectAnalysisId }
  | { kind: "selector-branch"; id: ProjectAnalysisId }
  | { kind: "css-module-import"; id: ProjectAnalysisId }
  | { kind: "css-module-member-reference"; id: ProjectAnalysisId }
  | { kind: "css-module-reference-diagnostic"; id: ProjectAnalysisId }
  | { kind: "selector-query"; id: ProjectAnalysisId };

export type Finding = {
  id: string;
  ruleId: RuleId;
  severity: RuleSeverity;
  confidence: AnalysisConfidence;
  message: string;
  subject: AnalysisEntityRef;
  location?: SourceAnchor;
  evidence: AnalysisEntityRef[];
  traces: AnalysisTrace[];
  data?: Record<string, unknown>;
};

export type UnresolvedFinding = Omit<Finding, "severity">;

export type RuleContext = {
  analysis: ProjectAnalysis;
};

export type RuleDefinition = {
  id: RuleId;
  run(context: RuleContext): UnresolvedFinding[];
};

export type RuleEngineResult = {
  findings: Finding[];
};
