import type { ProjectEvidenceId } from "../project-evidence/index.js";
import type { RenderedElementId } from "../render-structure/index.js";
import { elementPropertyKey } from "./ids.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisIndexes,
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
  diagnostics: CascadeAnalysisDiagnostic[];
}): CascadeAnalysisIndexes {
  const declarationRecordById = new Map(
    input.declarations.map((declaration) => [declaration.declarationId, declaration]),
  );
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const outcomeById = new Map(input.outcomes.map((outcome) => [outcome.id, outcome]));
  const conditionSetById = new Map(
    input.conditionSets.map((conditionSet) => [conditionSet.id, conditionSet]),
  );
  const candidateIdsByDeclarationId = new Map<ProjectEvidenceId, string[]>();
  const candidateIdsBySelectorBranchId = new Map<ProjectEvidenceId, string[]>();
  const candidateIdsByElementId = new Map<RenderedElementId, string[]>();
  const candidateIdsByElementAndProperty = new Map<string, string[]>();
  const candidateIdsByConditionSetId = new Map<string, string[]>();
  const outcomeIdsByElementId = new Map<RenderedElementId, string[]>();
  const outcomeIdsByWinningCandidateId = new Map<string, string[]>();
  const diagnosticIdsByDeclarationId = new Map<ProjectEvidenceId, string[]>();
  const diagnosticIdsBySelectorBranchId = new Map<ProjectEvidenceId, string[]>();

  for (const candidate of input.candidates) {
    pushMapValue(candidateIdsByDeclarationId, candidate.declarationId, candidate.id);
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
    candidateIdsBySelectorBranchId,
    candidateIdsByElementId,
    candidateIdsByElementAndProperty,
    candidateIdsByConditionSetId,
    outcomeIdsByElementId,
    outcomeIdsByWinningCandidateId,
    diagnosticIdsByDeclarationId,
    diagnosticIdsBySelectorBranchId,
  ].forEach(sortMapValues);

  return {
    declarationRecordById,
    candidateById,
    outcomeById,
    conditionSetById,
    candidateIdsByDeclarationId,
    candidateIdsBySelectorBranchId,
    candidateIdsByElementId,
    candidateIdsByElementAndProperty,
    candidateIdsByConditionSetId,
    outcomeIdsByElementId,
    outcomeIdsByWinningCandidateId,
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
