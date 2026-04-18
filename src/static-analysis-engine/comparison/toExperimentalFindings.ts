import type { ExperimentalRuleResult } from "../pipeline/rule-execution/types.js";
import type { ExperimentalFindingLike } from "./types.js";

export function toExperimentalFindings(
  experimentalRuleResults: ExperimentalRuleResult[],
): ExperimentalFindingLike[] {
  return experimentalRuleResults.map((experimentalRuleResult) => ({
    ruleId: experimentalRuleResult.ruleId,
    severity: experimentalRuleResult.severity,
    confidence: experimentalRuleResult.confidence,
    message: experimentalRuleResult.summary,
    filePath: experimentalRuleResult.primaryLocation?.filePath,
    line: experimentalRuleResult.primaryLocation?.line,
    selectorText: experimentalRuleResult.selectorText,
    source: "experimental",
    experimentalRuleResult,
  }));
}
