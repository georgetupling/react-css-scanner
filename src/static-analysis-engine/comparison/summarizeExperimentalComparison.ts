import type {
  ExperimentalFindingComparison,
  ExperimentalFindingComparisonSummary,
} from "./types.js";

export function summarizeExperimentalComparison(
  comparison: ExperimentalFindingComparison,
): ExperimentalFindingComparisonSummary {
  const experimentalRuleIds = new Set<string>();
  const baselineRuleIds = new Set<string>();

  for (const match of comparison.matched) {
    experimentalRuleIds.add(match.experimental.ruleId);
    baselineRuleIds.add(match.baseline.ruleId);
  }

  for (const finding of comparison.experimentalOnly) {
    experimentalRuleIds.add(finding.ruleId);
  }

  for (const finding of comparison.baselineOnly) {
    baselineRuleIds.add(finding.ruleId);
  }

  return {
    matchedCount: comparison.matched.length,
    experimentalOnlyCount: comparison.experimentalOnly.length,
    baselineOnlyCount: comparison.baselineOnly.length,
    experimentalRuleIds: [...experimentalRuleIds].sort((left, right) => left.localeCompare(right)),
    baselineRuleIds: [...baselineRuleIds].sort((left, right) => left.localeCompare(right)),
  };
}
