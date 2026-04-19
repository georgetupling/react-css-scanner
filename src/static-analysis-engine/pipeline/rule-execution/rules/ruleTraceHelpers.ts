import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SelectorQueryResult } from "../../selector-analysis/types.js";

export function createSelectorRuleTraces(input: {
  ruleId: string;
  summary: string;
  selectorQueryResult: SelectorQueryResult;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:${input.ruleId}:${input.selectorQueryResult.selectorText}`,
      category: "rule-evaluation",
      summary: input.summary,
      ...(input.selectorQueryResult.source.kind === "css-source" &&
      input.selectorQueryResult.source.selectorAnchor
        ? {
            anchor: input.selectorQueryResult.source.selectorAnchor,
          }
        : {}),
      children: [...input.selectorQueryResult.decision.traces],
      metadata: {
        ruleId: input.ruleId,
        selectorText: input.selectorQueryResult.selectorText,
        outcome: input.selectorQueryResult.outcome,
        status: input.selectorQueryResult.status,
      },
    },
  ];
}
