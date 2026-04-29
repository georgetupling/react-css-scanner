import type { ClassExpressionSummary } from "../render-model/abstract-values/types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  RuntimeDomClassSite,
  RuntimeDomClassSiteKind,
  RuntimeDomLibraryHint as FrontendRuntimeDomLibraryHint,
} from "../language-frontends/types.js";

export type RuntimeDomClassReferenceKind = RuntimeDomClassSiteKind;
export type RuntimeDomLibraryHint = FrontendRuntimeDomLibraryHint;

export type RuntimeDomClassReference = {
  kind: RuntimeDomClassReferenceKind;
  filePath: string;
  location: RuntimeDomClassSite["location"];
  rawExpressionText: string;
  classExpression: ClassExpressionSummary;
  runtimeLibraryHint?: RuntimeDomLibraryHint;
};

export type RuntimeDomReferenceTraceInput = {
  site: RuntimeDomClassSite;
  includeTraces: boolean;
};

export type RuntimeDomReferenceTrace = AnalysisTrace;
