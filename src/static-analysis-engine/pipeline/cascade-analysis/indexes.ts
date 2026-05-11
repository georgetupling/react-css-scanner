import type { ProjectEvidenceId } from "../project-evidence/index.js";
import type { RenderedElementId } from "../render-structure/index.js";
import { elementPropertyKey } from "./ids.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisIndexes,
  CascadeComputedProperty,
  CascadeDeclarationCandidate,
  CascadeConditionSet,
  CascadeOutcome,
  CssDeclarationCascadeRecord,
} from "./types.js";

export function buildCascadeAnalysisIndexes(input: {
  declarations: CssDeclarationCascadeRecord[];
  conditionSets: CascadeConditionSet[];
  candidates: CascadeDeclarationCandidate[];
  outcomes: CascadeOutcome[];
  computedProperties: CascadeComputedProperty[];
  diagnostics: CascadeAnalysisDiagnostic[];
}): CascadeAnalysisIndexes {
  const declarationRecordById = new Map(
    input.declarations.map((declaration) => [declaration.declarationId, declaration]),
  );
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const outcomeById = new Map(input.outcomes.map((outcome) => [outcome.id, outcome]));
  const computedPropertyById = new Map(
    input.computedProperties.map((property) => [property.id, property]),
  );
  const conditionSetById = new Map(
    input.conditionSets.map((conditionSet) => [conditionSet.id, conditionSet]),
  );
  const candidateIdsByDeclarationId = new Map<ProjectEvidenceId, string[]>();
  const candidateIdsByInlineStyleId = new Map<string, string[]>();
  const candidateIdsBySelectorBranchId = new Map<ProjectEvidenceId, string[]>();
  const candidateIdsByElementId = new Map<RenderedElementId, string[]>();
  const candidateIdsByElementAndProperty = new Map<string, string[]>();
  const candidateIdsByConditionSetId = new Map<string, string[]>();
  const outcomeIdsByElementId = new Map<RenderedElementId, string[]>();
  const outcomeIdsByWinningCandidateId = new Map<string, string[]>();
  const computedPropertyIdsByElementId = new Map<RenderedElementId, string[]>();
  const computedPropertyIdByElementAndProperty = new Map<string, string>();
  const computedPropertyIdsByOutcomeId = new Map<string, string[]>();
  const diagnosticIdsByDeclarationId = new Map<ProjectEvidenceId, string[]>();
  const diagnosticIdsBySelectorBranchId = new Map<ProjectEvidenceId, string[]>();

  for (const candidate of input.candidates) {
    if (candidate.declarationId) {
      pushMapValue(candidateIdsByDeclarationId, candidate.declarationId, candidate.id);
    }
    if (candidate.inlineStyleId) {
      pushMapValue(candidateIdsByInlineStyleId, candidate.inlineStyleId, candidate.id);
    }
    pushMapValue(candidateIdsByElementId, candidate.elementId, candidate.id);
    pushMapValue(candidateIdsByElementAndProperty, elementPropertyKey(candidate), candidate.id);
    if (candidate.selectorBranchId) {
      pushMapValue(candidateIdsBySelectorBranchId, candidate.selectorBranchId, candidate.id);
    }
    if (candidate.conditionSetId) {
      pushMapValue(candidateIdsByConditionSetId, candidate.conditionSetId, candidate.id);
    }
  }

  for (const outcome of input.outcomes) {
    pushMapValue(outcomeIdsByElementId, outcome.elementId, outcome.id);
    if (outcome.winningCandidateId) {
      pushMapValue(outcomeIdsByWinningCandidateId, outcome.winningCandidateId, outcome.id);
    }
  }

  for (const computedProperty of input.computedProperties) {
    pushMapValue(computedPropertyIdsByElementId, computedProperty.elementId, computedProperty.id);
    computedPropertyIdByElementAndProperty.set(
      elementPropertyKey(computedProperty),
      computedProperty.id,
    );
    if (computedProperty.outcomeId) {
      pushMapValue(computedPropertyIdsByOutcomeId, computedProperty.outcomeId, computedProperty.id);
    }
  }

  for (const diagnostic of input.diagnostics) {
    if (diagnostic.declarationId) {
      pushMapValue(diagnosticIdsByDeclarationId, diagnostic.declarationId, diagnostic.id);
    }
    if (diagnostic.selectorBranchId) {
      pushMapValue(diagnosticIdsBySelectorBranchId, diagnostic.selectorBranchId, diagnostic.id);
    }
  }

  [
    candidateIdsByDeclarationId,
    candidateIdsByInlineStyleId,
    candidateIdsBySelectorBranchId,
    candidateIdsByElementId,
    candidateIdsByElementAndProperty,
    candidateIdsByConditionSetId,
    outcomeIdsByElementId,
    outcomeIdsByWinningCandidateId,
    computedPropertyIdsByElementId,
    computedPropertyIdsByOutcomeId,
    diagnosticIdsByDeclarationId,
    diagnosticIdsBySelectorBranchId,
  ].forEach(sortMapValues);

  return {
    declarationRecordById,
    candidateById,
    outcomeById,
    computedPropertyById,
    conditionSetById,
    candidateIdsByDeclarationId,
    candidateIdsByInlineStyleId,
    candidateIdsBySelectorBranchId,
    candidateIdsByElementId,
    candidateIdsByElementAndProperty,
    candidateIdsByConditionSetId,
    outcomeIdsByElementId,
    outcomeIdsByWinningCandidateId,
    computedPropertyIdsByElementId,
    computedPropertyIdByElementAndProperty,
    computedPropertyIdsByOutcomeId,
    diagnosticIdsByDeclarationId,
    diagnosticIdsBySelectorBranchId,
  };
}

function pushMapValue<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...new Set(values)].sort((left, right) => left.localeCompare(right)),
    );
  }
}
