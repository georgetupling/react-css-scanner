import { buildIndexes } from "./indexes.js";
import { buildClassOwnershipEvidence } from "./classOwnership.js";
import { buildDefinitionConsumers } from "./consumers.js";
import { applySelectorContextEvidence } from "./selectorContext.js";
import { buildStylesheetOwnership } from "./stylesheets.js";
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
  sharingPolicy?: "strict" | "balanced" | "permissive";
  rootHtmlEntryLinkedStylesheetPaths?: string[];
  includeTraces?: boolean;
};

export function buildOwnershipInference(input: OwnershipInferenceInput): OwnershipInferenceResult {
  const definitionConsumers = buildDefinitionConsumers({
    projectEvidence: input.projectEvidence,
    selectorReachability: input.selectorReachability,
  });
  const stylesheetEvidence = buildStylesheetOwnership({
    projectEvidence: input.projectEvidence,
    options: input.options,
  });
  const classOwnershipEvidence = buildClassOwnershipEvidence({
    projectEvidence: input.projectEvidence,
    definitionConsumers,
    stylesheetOwnership: stylesheetEvidence.stylesheetOwnership,
    includeTraces: input.options?.includeTraces ?? true,
  });
  const ownerCandidatesBeforeSelectorContext = [
    ...classOwnershipEvidence.ownerCandidates,
    ...stylesheetEvidence.ownerCandidates,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const selectorContextEvidence = applySelectorContextEvidence({
    projectEvidence: input.projectEvidence,
    selectorReachability: input.selectorReachability,
    classOwnership: classOwnershipEvidence.classOwnership,
    definitionConsumers,
    ownerCandidates: ownerCandidatesBeforeSelectorContext,
    classifications: stylesheetEvidence.classifications,
    includeTraces: input.options?.includeTraces ?? true,
  });
  const stylesheetOwnership = stylesheetEvidence.stylesheetOwnership;
  const ownerCandidates = selectorContextEvidence.ownerCandidates;
  const classifications = selectorContextEvidence.classifications;
  const diagnostics: OwnershipInferenceResult["diagnostics"] = [];

  return {
    meta: {
      generatedAtStage: "ownership-inference",
      classOwnershipCount: selectorContextEvidence.classOwnership.length,
      definitionConsumerCount: definitionConsumers.length,
      ownerCandidateCount: ownerCandidates.length,
      stylesheetOwnershipCount: stylesheetOwnership.length,
      classificationCount: classifications.length,
      diagnosticCount: diagnostics.length,
    },
    classOwnership: selectorContextEvidence.classOwnership,
    definitionConsumers: selectorContextEvidence.definitionConsumers,
    ownerCandidates,
    stylesheetOwnership,
    classifications,
    diagnostics,
    indexes: buildIndexes({
      classOwnership: selectorContextEvidence.classOwnership,
      definitionConsumers: selectorContextEvidence.definitionConsumers,
      ownerCandidates,
      stylesheetOwnership,
      classifications,
      diagnostics,
    }),
  };
}
