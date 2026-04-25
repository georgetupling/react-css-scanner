import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";

export type UnsupportedClassReferenceReason = "raw-jsx-class-not-modeled";

export type UnsupportedClassReferenceDiagnostic = {
  sourceAnchor: SourceAnchor;
  rawExpressionText: string;
  reason: UnsupportedClassReferenceReason;
  traces: AnalysisTrace[];
};
