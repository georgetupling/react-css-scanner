import type { SourceAnchor } from "./core.js";

export type AnalysisCertainty = "definite" | "possible" | "unknown";

export type AnalysisDimensionState =
  | AnalysisCertainty
  | "unavailable"
  | "unsupported"
  | "budget-exceeded"
  | "not-found-under-bounded-analysis";

export type AnalysisStatus = "resolved" | "unsupported" | "budget-exceeded";

export type AnalysisConfidence = "high" | "medium" | "low";

export type AnalysisTraceCategory =
  | "symbol-resolution"
  | "value-evaluation"
  | "render-graph"
  | "render-expansion"
  | "selector-parsing"
  | "selector-match"
  | "reachability"
  | "rule-evaluation";

export type AnalysisTrace = {
  traceId: string;
  category: AnalysisTraceCategory;
  summary: string;
  anchor?: SourceAnchor;
  children: AnalysisTrace[];
  metadata?: Record<string, unknown>;
};

export type AnalysisDecision = {
  status: AnalysisStatus;
  certainty: AnalysisCertainty;
  dimensions: Record<string, AnalysisDimensionState>;
  reasons: string[];
  traces: AnalysisTrace[];
};

export function deriveAnalysisConfidence(
  decision: Pick<AnalysisDecision, "status" | "certainty">,
): AnalysisConfidence {
  if (decision.status !== "resolved" || decision.certainty === "unknown") {
    return "low";
  }

  if (decision.certainty === "possible") {
    return "medium";
  }

  return "high";
}
