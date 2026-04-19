import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import { deriveAnalysisConfidence } from "../../../types/analysis.js";
import type { ExperimentalRuleResult } from "../types.js";
import { createSelectorRuleTraces } from "./ruleTraceHelpers.js";

export function runSelectorPossiblySatisfiedRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (
    selectorQueryResult.outcome !== "possible-match" ||
    selectorQueryResult.status !== "resolved"
  ) {
    return undefined;
  }

  return {
    ruleId: "selector-possibly-satisfied",
    severity: "info",
    confidence: deriveAnalysisConfidence(selectorQueryResult.decision),
    summary: `selector is only possibly satisfied under bounded analysis: ${selectorQueryResult.selectorText}`,
    reasons: [
      "experimental Phase 7 pilot rule derived from bounded selector uncertainty",
      ...selectorQueryResult.reasons,
    ],
    primaryLocation: toPrimaryLocation(selectorQueryResult),
    selectorText: selectorQueryResult.selectorText,
    decision: selectorQueryResult.decision,
    selectorQueryResult,
    traces: createSelectorRuleTraces({
      ruleId: "selector-possibly-satisfied",
      summary: `selector is only possibly satisfied under bounded analysis: ${selectorQueryResult.selectorText}`,
      selectorQueryResult,
    }),
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
