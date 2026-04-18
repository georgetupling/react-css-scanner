import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";

export function runSelectorAnalysisUnsupportedRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (selectorQueryResult.status !== "unsupported") {
    return undefined;
  }

  return {
    ruleId: "selector-analysis-unsupported",
    severity: "info",
    confidence: selectorQueryResult.confidence,
    summary: `selector could not be evaluated under bounded analysis: ${selectorQueryResult.selectorText}`,
    reasons: [
      "experimental Phase 7 pilot rule derived from unsupported bounded selector analysis",
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
