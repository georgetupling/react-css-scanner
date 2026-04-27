import { RULE_DEFINITIONS } from "../rules/index.js";
import type { Finding, RuleSeverity } from "../rules/index.js";
import type { RuleCounts, SeverityCounts } from "./types.js";

export function countFindingsByRule(findings: Finding[]): RuleCounts {
  const counts = Object.fromEntries(RULE_DEFINITIONS.map((rule) => [rule.id, 0])) as RuleCounts;

  for (const finding of findings) {
    counts[finding.ruleId] += 1;
  }

  return counts;
}

export function countFindingsBySeverity(findings: Finding[]): SeverityCounts {
  return {
    debug: countFindingsWithSeverity(findings, "debug"),
    info: countFindingsWithSeverity(findings, "info"),
    warn: countFindingsWithSeverity(findings, "warn"),
    error: countFindingsWithSeverity(findings, "error"),
  };
}

function countFindingsWithSeverity(findings: Finding[], severity: RuleSeverity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}
