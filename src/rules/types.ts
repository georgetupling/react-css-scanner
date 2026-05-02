import type {
  AnalysisEvidence,
  AnalysisConfidence,
  AnalysisTrace,
  ProjectEvidenceId,
  SourceAnchor,
} from "../static-analysis-engine/index.js";
import type { PackageCssImportFact } from "../static-analysis-engine/pipeline/workspace-discovery/index.js";
import type { ScannerConfig } from "../config/index.js";

export type RuleSeverity = "debug" | "info" | "warn" | "error" | "off";

export type RuleId =
  | "missing-css-class"
  | "css-class-unreachable"
  | "unused-css-class"
  | "missing-css-module-class"
  | "unused-css-module-class"
  | "unsatisfiable-selector"
  | "compound-selector-never-matched"
  | "unused-compound-selector-branch"
  | "selector-only-matches-in-unknown-contexts"
  | "single-component-style-not-colocated"
  | "style-used-outside-owner"
  | "style-shared-without-shared-owner"
  | "dynamic-class-reference"
  | "unsupported-syntax-affecting-analysis";

export type AnalysisEntityRef =
  | { kind: "source-file"; id: ProjectEvidenceId }
  | { kind: "component"; id: ProjectEvidenceId }
  | { kind: "stylesheet"; id: ProjectEvidenceId }
  | { kind: "class-reference"; id: ProjectEvidenceId }
  | { kind: "statically-skipped-class-reference"; id: ProjectEvidenceId }
  | { kind: "unsupported-class-reference"; id: ProjectEvidenceId }
  | { kind: "class-definition"; id: ProjectEvidenceId }
  | { kind: "selector-branch"; id: ProjectEvidenceId }
  | { kind: "css-module-import"; id: ProjectEvidenceId }
  | { kind: "css-module-member-reference"; id: ProjectEvidenceId }
  | { kind: "css-module-reference-diagnostic"; id: ProjectEvidenceId }
  | { kind: "selector-query"; id: ProjectEvidenceId };

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
  analysisEvidence: AnalysisEvidence;
  externalCssPackageImports?: PackageCssImportFact[];
  config: ScannerConfig;
  includeTraces?: boolean;
};

export type RuleDefinition = {
  id: RuleId;
  run(context: RuleContext): UnresolvedFinding[];
};

export type RuleEngineResult = {
  findings: Finding[];
};
