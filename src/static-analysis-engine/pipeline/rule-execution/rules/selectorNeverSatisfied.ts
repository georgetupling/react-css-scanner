import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";

export function runSelectorNeverSatisfiedRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (
    selectorQueryResult.outcome !== "no-match-under-bounded-analysis" ||
    selectorQueryResult.status !== "resolved"
  ) {
    return undefined;
  }

  return {
    ruleId: "selector-never-satisfied",
    severity: "info",
    confidence: selectorQueryResult.confidence,
    summary: `selector appears never satisfied under bounded analysis: ${selectorQueryResult.selectorText}`,
    reasons: [
      "experimental Phase 7 pilot rule derived from resolved selector satisfiability analysis",
      ...selectorQueryResult.reasons,
    ],
    primaryLocation: toPrimaryLocation(selectorQueryResult),
    selectorText: selectorQueryResult.selectorText,
    selectorQueryResult,
  };
}

function toPrimaryLocation(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult["primaryLocation"] {
  if (selectorQueryResult.source.kind !== "css-source") {
    return undefined;
  }

  return {
    filePath: selectorQueryResult.source.selectorAnchor?.filePath,
    line: selectorQueryResult.source.selectorAnchor?.startLine,
  };
}
