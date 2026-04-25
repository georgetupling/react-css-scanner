import type { AnalysisDecision, AnalysisTrace, AnalysisCertainty } from "../../types/analysis.js";
import { deriveAnalysisConfidence } from "../../types/analysis.js";
import type { ParsedSelectorQuery, SelectorQueryResult } from "./types.js";

export function buildSelectorQueryResult(input: {
  selectorQuery: ParsedSelectorQuery;
  outcome: SelectorQueryResult["outcome"];
  status: SelectorQueryResult["status"];
  certainty: AnalysisCertainty;
  reasons: string[];
  traces: AnalysisTrace[];
  includeTraces?: boolean;
  dimensions?: AnalysisDecision["dimensions"];
  reachability?: SelectorQueryResult["reachability"];
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  const decision: AnalysisDecision = {
    status: input.status,
    certainty: input.certainty,
    dimensions: { ...(input.dimensions ?? {}) },
    reasons: [...input.reasons],
    traces: includeTraces ? [...input.traces] : [],
  };

  return {
    selectorText: input.selectorQuery.selectorText,
    source: input.selectorQuery.source,
    constraint: input.selectorQuery.constraint,
    outcome: input.outcome,
    status: input.status,
    confidence: deriveAnalysisConfidence(decision),
    reasons: [...input.reasons],
    decision,
    ...(input.reachability ? { reachability: input.reachability } : {}),
  };
}
