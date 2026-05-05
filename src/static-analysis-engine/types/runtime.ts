import type { OwnershipInferenceResult } from "../pipeline/ownership-inference/index.js";
import type { ProjectEvidenceAssemblyResult } from "../pipeline/project-evidence/index.js";
import type { RuntimeCssLoadingResult } from "../pipeline/runtime-css-loading/index.js";
import type { SelectorReachabilityResult } from "../pipeline/selector-reachability/index.js";
import type { ProjectSnapshot } from "../pipeline/workspace-discovery/index.js";

export type AnalysisEvidence = {
  projectEvidence: ProjectEvidenceAssemblyResult;
  runtimeCssLoading: RuntimeCssLoadingResult;
  selectorReachability: SelectorReachabilityResult;
  ownershipInference?: OwnershipInferenceResult;
};

export type StaticAnalysisEngineResult = {
  analysisEvidence: AnalysisEvidence;
};

export type StaticAnalysisEngineProjectResult = StaticAnalysisEngineResult & {
  snapshot: ProjectSnapshot;
};

export type AnalysisProgressStatus = "started" | "completed";

export type AnalysisProgressEvent = {
  stage: string;
  status: AnalysisProgressStatus;
  message: string;
  durationMs?: number;
};

export type AnalysisProgressCallback = (event: AnalysisProgressEvent) => void;

export type AnalysisRuntimeOptions = {
  includeTraces?: boolean;
};
