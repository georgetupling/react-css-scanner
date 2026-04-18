import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";

export function runUnusedCompoundSelectorBranchRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (
    selectorQueryResult.source.kind !== "css-source" ||
    selectorQueryResult.outcome !== "no-match-under-bounded-analysis" ||
    selectorQueryResult.status !== "resolved"
  ) {
    return undefined;
  }

  if (selectorQueryResult.constraint?.kind !== "same-node-class-conjunction") {
    return undefined;
  }

  return {
    ruleId: "unused-compound-selector-branch",
    severity: "info",
    confidence: selectorQueryResult.confidence,
    summary: `Compound selector branch "${selectorQueryResult.selectorText}" does not have any convincing reachable React usage where all required classes appear together.`,
    reasons: [
      "experimental Phase 7 pilot rule derived from same-node compound selector satisfiability analysis",
      ...selectorQueryResult.reasons,
    ],
    primaryLocation: {
      filePath: selectorQueryResult.source.selectorAnchor?.filePath,
      line: selectorQueryResult.source.selectorAnchor?.startLine,
    },
    selectorText: selectorQueryResult.selectorText,
    selectorQueryResult,
  };
}
