import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import { deriveAnalysisConfidence } from "../../../types/analysis.js";
import type { ExperimentalRuleResult } from "../types.js";
import { createSelectorRuleTraces } from "./ruleTraceHelpers.js";

export function runSelectorAnalysisUnsupportedRule(
  selectorQueryResult: SelectorQueryResult,
): ExperimentalRuleResult | undefined {
  if (selectorQueryResult.status !== "unsupported") {
    return undefined;
  }

  return {
    ruleId: "selector-analysis-unsupported",
    severity: "info",
    confidence: deriveAnalysisConfidence(selectorQueryResult.decision),
    summary: `selector could not be evaluated under bounded analysis: ${selectorQueryResult.selectorText}`,
    reasons: [
      "experimental Phase 7 pilot rule derived from unsupported bounded selector analysis",
      ...selectorQueryResult.reasons,
    ],
    primaryLocation: toPrimaryLocation(selectorQueryResult),
    selectorText: selectorQueryResult.selectorText,
    decision: selectorQueryResult.decision,
    selectorQueryResult,
    traces: createSelectorRuleTraces({
      ruleId: "selector-analysis-unsupported",
      summary: `selector could not be evaluated under bounded analysis: ${selectorQueryResult.selectorText}`,
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
