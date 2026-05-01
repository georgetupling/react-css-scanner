import { buildOwnershipInference } from "../../pipeline/ownership-inference/index.js";
import type { SelectorReachabilityResult } from "../../pipeline/selector-reachability/index.js";
import type { ProjectEvidenceAssemblyResult } from "../../pipeline/project-evidence/index.js";
import type { OwnershipInferenceStageResult } from "./types.js";

export function runOwnershipInferenceStage(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
  includeTraces?: boolean;
}): OwnershipInferenceStageResult {
  return {
    ownershipInference: buildOwnershipInference({
      projectEvidence: input.projectEvidence,
      selectorReachability: input.selectorReachability,
      options: {
        includeTraces: input.includeTraces ?? true,
        sharedCssPatterns: [],
      },
    }),
  };
}
