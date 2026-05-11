import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import { cascadeDiagnosticId, cascadeOutcomeId, elementPropertyKey } from "./ids.js";
import { compareSpecificity } from "./specificity.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeComparisonReason,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CascadeOutcome,
} from "./types.js";

type CandidateConditionCompatibility = {
  compatibility: "definite" | "conditional" | "unknown";
  detail: string;
};

export function buildOutcomes(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
  conditionSetsById: Map<string, CascadeConditionSet>;
  diagnostics: CascadeAnalysisDiagnostic[];
}): CascadeOutcome[] {
  const candidatesByElementProperty = new Map<string, CascadeDeclarationCandidate[]>();
  for (const candidate of input.candidates) {
    const key = elementPropertyKey(candidate);
    candidatesByElementProperty.set(key, [
      ...(candidatesByElementProperty.get(key) ?? []),
      candidate,
    ]);
  }

  const outcomes: CascadeOutcome[] = [];
  for (const candidates of candidatesByElementProperty.values()) {
    const sortedCandidates = candidates.sort(compareCandidates);
    const winner = sortedCandidates.at(-1);
    if (!winner) {
      continue;
    }
    const stylesheets = new Set(
      sortedCandidates
        .map((candidate) =>
          candidate.declarationId
            ? input.projectEvidence.indexes.cssDeclarationsById.get(candidate.declarationId)
                ?.stylesheetId
            : undefined,
        )
        .filter((stylesheetId): stylesheetId is string => Boolean(stylesheetId)),
    );
    const orderKnown = sortedCandidates.every((candidate) => candidate.cascadeKey.orderKnown);
    if (stylesheets.size > 1 && !orderKnown) {
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "order-uncertain",
        comparisonTrace: [
          {
            reason: "order-uncertain",
            certainty: "unknown",
            detail:
              "Candidates come from multiple stylesheets and project source order is not normalized yet.",
          },
        ],
        traces: [],
      });
      continue;
    }
    const layerOrderKnown = sortedCandidates.every(
      (candidate) => candidate.cascadeKey.layer?.known ?? true,
    );
    if (!layerOrderKnown) {
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "layer-order",
        comparisonTrace: [
          {
            reason: "layer-order",
            certainty: "unknown",
            detail: "One or more candidates use anonymous or unsupported cascade layer ordering.",
          },
        ],
        traces: [],
      });
      continue;
    }

    const conditionCompatibility = compareCandidateConditionSets(
      sortedCandidates,
      input.conditionSetsById,
    );
    if (conditionCompatibility.compatibility === "unknown") {
      input.diagnostics.push({
        id: cascadeDiagnosticId({
          code: "unknown-condition-compatibility",
          elementId: winner.elementId,
          index: input.diagnostics.length,
        }),
        code: "unknown-condition-compatibility",
        severity: "debug",
        confidence: "high",
        message: `Cascade candidates for "${winner.property}" have condition sets that cannot be reduced to one winner.`,
        elementId: winner.elementId,
        traces: [],
      });
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "condition-uncertain",
        comparisonTrace: [
          {
            reason: "condition-uncertain",
            certainty: "unknown",
            detail: conditionCompatibility.detail,
          },
        ],
        traces: [],
      });
      continue;
    }

    const second = sortedCandidates.at(-2);
    const reason = second ? compareCandidatesReason(winner, second) : "source-order";
    const certainty =
      winner.matchCertainty === "definite" && conditionCompatibility.compatibility === "definite"
        ? "definite"
        : "possible";
    outcomes.push({
      id: cascadeOutcomeId(winner),
      elementId: winner.elementId,
      property: winner.property,
      winningCandidateId: winner.id,
      losingCandidateIds: sortedCandidates
        .filter((candidate) => candidate.id !== winner.id)
        .map((candidate) => candidate.id),
      unresolvedCandidateIds: [],
      certainty,
      reason,
      comparisonTrace: sortedCandidates
        .filter((candidate) => candidate.id !== winner.id)
        .map((candidate) => ({
          reason: compareCandidatesReason(winner, candidate),
          winningCandidateId: winner.id,
          losingCandidateId: candidate.id,
          certainty,
          detail:
            conditionCompatibility.compatibility === "conditional"
              ? "Cascade candidates compared within the same conditional context."
              : "Cascade candidates compared by importance, origin, layer, specificity, and known source order.",
        })),
      traces: [],
    });
  }

  return outcomes;
}

export function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function compareCandidateConditionSets(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CandidateConditionCompatibility {
  const conditionSignatures = new Set(
    candidates.map((candidate) =>
      serializeConditionSet(
        candidate.conditionSetId ? conditionSetsById.get(candidate.conditionSetId) : undefined,
      ),
    ),
  );
  if (conditionSignatures.size > 1) {
    return {
      compatibility: "unknown",
      detail:
        "Candidates have different at-rule or render conditions, so different runtime contexts may produce different winners.",
    };
  }

  const conditionSet = candidates[0]?.conditionSetId
    ? conditionSetsById.get(candidates[0].conditionSetId)
    : undefined;
  if (!conditionSet || conditionSet.sources.length === 0) {
    return {
      compatibility: "definite",
      detail: "All candidates are unconditional.",
    };
  }

  return {
    compatibility: "conditional",
    detail: "All candidates share the same conditional context.",
  };
}

function serializeConditionSet(conditionSet: CascadeConditionSet | undefined): string {
  if (!conditionSet) {
    return "unconditional";
  }
  return JSON.stringify({
    atRuleContext: conditionSet.atRuleContext,
    renderConditionIds: conditionSet.renderConditionIds,
    classEmissionConditionIds: conditionSet.classEmissionConditionIds,
    pseudoStates: conditionSet.pseudoStates,
    runtimeContextIds: conditionSet.runtimeContextIds,
  });
}

function compareCandidates(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return (
    Number(left.cascadeKey.important) - Number(right.cascadeKey.important) ||
    originPrecedenceRank(left) - originPrecedenceRank(right) ||
    compareLayerPrecedence(left, right) ||
    compareSpecificity(left.cascadeKey.specificity, right.cascadeKey.specificity) ||
    (left.cascadeKey.sourceOrder ?? 0) - (right.cascadeKey.sourceOrder ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function compareCandidatesReason(
  winner: CascadeDeclarationCandidate,
  loser: CascadeDeclarationCandidate,
): CascadeComparisonReason {
  if (winner.cascadeKey.important !== loser.cascadeKey.important) {
    return "important";
  }
  if (originPrecedenceRank(winner) !== originPrecedenceRank(loser)) {
    return "higher-origin";
  }
  if (compareLayerPrecedence(winner, loser) !== 0) {
    return "layer-order";
  }
  if (compareSpecificity(winner.cascadeKey.specificity, loser.cascadeKey.specificity) !== 0) {
    return "specificity";
  }
  return "source-order";
}

function originPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  switch (candidate.cascadeKey.origin) {
    case "user-agent":
      return 0;
    case "user":
      return 1;
    case "author":
      return 2;
    case "inline":
      return 3;
    default:
      return -1;
  }
}

function compareLayerPrecedence(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return layerPrecedenceRank(left) - layerPrecedenceRank(right);
}

function layerPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  const layer = candidate.cascadeKey.layer;
  if (!layer || layer.unlayered) {
    return candidate.cascadeKey.important ? -1_000_000 : 1_000_000;
  }
  const layerOrder = layer.order ?? 0;
  return candidate.cascadeKey.important ? -layerOrder : layerOrder;
}
