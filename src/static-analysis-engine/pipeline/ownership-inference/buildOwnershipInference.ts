import { buildIndexes } from "./indexes.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { SelectorReachabilityResult } from "../selector-reachability/index.js";
import type { OwnershipInferenceResult } from "./types.js";

export type OwnershipInferenceInput = {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
  options?: OwnershipInferenceOptions;
};

export type OwnershipInferenceOptions = {
  sharedCssPatterns?: string[];
  includeTraces?: boolean;
};

export function buildOwnershipInference(input: OwnershipInferenceInput): OwnershipInferenceResult {
  void input;

  const classOwnership: OwnershipInferenceResult["classOwnership"] = [];
  const definitionConsumers: OwnershipInferenceResult["definitionConsumers"] = [];
  const ownerCandidates: OwnershipInferenceResult["ownerCandidates"] = [];
  const stylesheetOwnership: OwnershipInferenceResult["stylesheetOwnership"] = [];
  const classifications: OwnershipInferenceResult["classifications"] = [];
  const diagnostics: OwnershipInferenceResult["diagnostics"] = [];

  return {
    meta: {
      generatedAtStage: "ownership-inference",
      classOwnershipCount: classOwnership.length,
      definitionConsumerCount: definitionConsumers.length,
      ownerCandidateCount: ownerCandidates.length,
      stylesheetOwnershipCount: stylesheetOwnership.length,
      classificationCount: classifications.length,
      diagnosticCount: diagnostics.length,
    },
    classOwnership,
    definitionConsumers,
    ownerCandidates,
    stylesheetOwnership,
    classifications,
    diagnostics,
    indexes: buildIndexes({
      classOwnership,
      definitionConsumers,
      ownerCandidates,
      stylesheetOwnership,
      classifications,
      diagnostics,
    }),
  };
}
