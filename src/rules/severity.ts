import type { RuleSeverity } from "./types.js";

const SEVERITY_RANK: Record<RuleSeverity, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function severityMeetsThreshold(severity: RuleSeverity, threshold: RuleSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
