import type { ExperimentalRuleComparisonResult } from "./types.js";

export function formatExperimentalComparisonReport(
  comparisonResult: ExperimentalRuleComparisonResult,
): string {
  const lines = [
    "Experimental Rule Pilot Report",
    `Matched: ${comparisonResult.summary.matchedCount}`,
    `Experimental Only: ${comparisonResult.summary.experimentalOnlyCount}`,
    `Baseline Only: ${comparisonResult.summary.baselineOnlyCount}`,
    `Experimental Rules: ${formatRuleIds(comparisonResult.summary.experimentalRuleIds)}`,
    `Baseline Rules: ${formatRuleIds(comparisonResult.summary.baselineRuleIds)}`,
  ];

  if (comparisonResult.comparison.experimentalOnly.length > 0) {
    lines.push("Experimental-Only Findings:");
    for (const finding of comparisonResult.comparison.experimentalOnly) {
      lines.push(`- ${finding.ruleId}: ${finding.message}`);
    }
  }

  if (comparisonResult.comparison.baselineOnly.length > 0) {
    lines.push("Baseline-Only Findings:");
    for (const finding of comparisonResult.comparison.baselineOnly) {
      lines.push(`- ${finding.ruleId}: ${finding.message}`);
    }
  }

  return lines.join("\n");
}

function formatRuleIds(ruleIds: string[]): string {
  return ruleIds.length > 0 ? ruleIds.join(", ") : "(none)";
}
