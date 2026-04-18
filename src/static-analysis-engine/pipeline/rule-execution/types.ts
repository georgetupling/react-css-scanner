import type { FindingConfidence, FindingSeverity } from "../../../runtime/types.js";
import type { ExperimentalCssFileAnalysis } from "../css-analysis/types.js";
import type { SelectorQueryResult } from "../selector-analysis/types.js";

export type ExperimentalRuleId =
  | "selector-never-satisfied"
  | "selector-possibly-satisfied"
  | "selector-analysis-unsupported"
  | "unused-compound-selector-branch"
  | "contextual-selector-branch-never-satisfied"
  | "empty-css-rule"
  | "duplicate-css-class-definition"
  | "redundant-css-declaration-block";

export type ExperimentalRuleSeverity = FindingSeverity;

export type ExperimentalRuleResult = {
  ruleId: ExperimentalRuleId;
  severity: ExperimentalRuleSeverity;
  confidence: FindingConfidence;
  summary: string;
  reasons: string[];
  primaryLocation?: {
    filePath?: string;
    line?: number;
  };
  selectorText?: string;
  selectorQueryResult?: SelectorQueryResult;
  cssFile?: ExperimentalCssFileAnalysis;
  metadata?: Record<string, unknown>;
};
