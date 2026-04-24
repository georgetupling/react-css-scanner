import type {
  AnalysisConfidence,
  AnalysisDecision,
  AnalysisSeverity,
  AnalysisTrace,
} from "../../types/analysis.js";
import type { ExperimentalCssFileAnalysis } from "../css-analysis/types.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ModuleGraph } from "../module-graph/types.js";
import type { ReachabilitySummary } from "../reachability/types.js";
import type { SelectorQueryResult } from "../selector-analysis/types.js";
import type { ClassExpressionSummary } from "../abstract-values/types.js";

export type ExperimentalRuleId =
  | "selector-never-satisfied"
  | "selector-possibly-satisfied"
  | "selector-analysis-unsupported"
  | "unused-compound-selector-branch"
  | "contextual-selector-branch-never-satisfied"
  | "empty-css-rule"
  | "duplicate-css-class-definition"
  | "redundant-css-declaration-block"
  | "missing-external-css-class";

export type ExperimentalRuleExecutionInput = {
  moduleGraph: ModuleGraph;
  classExpressions: ClassExpressionSummary[];
  cssFiles: ExperimentalCssFileAnalysis[];
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: ReachabilitySummary;
  selectorQueryResults: SelectorQueryResult[];
};

export type ExperimentalRuleSeverity = AnalysisSeverity;

export type ExperimentalRuleResult = {
  ruleId: ExperimentalRuleId;
  severity: ExperimentalRuleSeverity;
  confidence: AnalysisConfidence;
  summary: string;
  reasons: string[];
  traces: AnalysisTrace[];
  primaryLocation?: {
    filePath?: string;
    line?: number;
  };
  selectorText?: string;
  decision?: AnalysisDecision;
  selectorQueryResult?: SelectorQueryResult;
  cssFile?: ExperimentalCssFileAnalysis;
  metadata?: Record<string, unknown>;
};
