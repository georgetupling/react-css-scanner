import type { Finding, FindingConfidence, FindingSeverity } from "../../runtime/types.js";
import type { ScanResult } from "../../runtime/types.js";
import type { ExperimentalRuleResult } from "../pipeline/rule-execution/types.js";
import type { StaticAnalysisEngineResult } from "../types/runtime.js";

export type ExperimentalFindingLike = {
  ruleId: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  message: string;
  filePath?: string;
  line?: number;
  selectorText?: string;
  source: "experimental";
  experimentalRuleResult: ExperimentalRuleResult;
};

export type ExperimentalFindingComparison = {
  matched: Array<{
    experimental: ExperimentalFindingLike;
    baseline: Finding;
  }>;
  experimentalOnly: ExperimentalFindingLike[];
  baselineOnly: Finding[];
};

export type ExperimentalFindingComparisonSummary = {
  matchedCount: number;
  experimentalOnlyCount: number;
  baselineOnlyCount: number;
  experimentalRuleIds: string[];
  baselineRuleIds: string[];
};

export type ExperimentalRuleComparisonResult = {
  experimentalFindings: ExperimentalFindingLike[];
  comparison: ExperimentalFindingComparison;
  summary: ExperimentalFindingComparisonSummary;
};

export type ExperimentalSelectorPilotArtifact = {
  engineResult: StaticAnalysisEngineResult;
  experimentalRuleResults: ExperimentalRuleResult[];
  comparisonResult: ExperimentalRuleComparisonResult;
  report: string;
};

export type ExperimentalSelectorPilotShadowArtifact = ExperimentalSelectorPilotArtifact & {
  baselineScanResult: ScanResult;
};
