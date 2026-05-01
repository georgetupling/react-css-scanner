import type { OwnershipInferenceResult } from "../ownership-inference/index.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { SelectorReachabilityResult } from "../selector-reachability/index.js";

export type AnalysisEvidence = {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
  ownershipInference: OwnershipInferenceResult;
};
