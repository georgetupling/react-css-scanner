import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import { compareCandidates, compareCandidatesReason } from "./candidateComparison.js";
import {
  buildModeledConditionBranchOutcome,
  buildPseudoStateBranchOutcome,
} from "./conditionBranches.js";
import { cascadeDiagnosticId, cascadeOutcomeId, elementPropertyKey } from "./ids.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CascadeOutcome,
} from "./types.js";

type CandidateConditionCompatibility = {
  compatibility: "definite" | "conditional" | "unknown";
  detail: string;
  branchOutcome?: CascadeOutcome;
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
      if (conditionCompatibility.branchOutcome) {
        outcomes.push(conditionCompatibility.branchOutcome);
        continue;
      }

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

function compareCandidateConditionSets(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CandidateConditionCompatibility {
  const conditionSignatures = new Set(
    candidates.map((candidate) => conditionSignature(candidate, conditionSetsById)),
  );
  if (conditionSignatures.size > 1) {
    const branchOutcome =
      buildModeledConditionBranchOutcome(candidates, conditionSetsById) ??
      buildPseudoStateBranchOutcome(candidates, conditionSetsById) ??
      buildConditionalBranchOutcome(candidates, conditionSetsById);
    if (branchOutcome) {
      return {
        compatibility: "unknown",
        detail:
          "Candidates have conditional branches; default and conditional winners are modeled separately.",
        branchOutcome,
      };
    }

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

function buildConditionalBranchOutcome(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CascadeOutcome | undefined {
  const unconditionalCandidates = candidates.filter((candidate) =>
    isUnconditionalCandidate(candidate, conditionSetsById),
  );
  if (unconditionalCandidates.length === 0) {
    return undefined;
  }

  const conditionalCandidatesBySignature = new Map<string, CascadeDeclarationCandidate[]>();
  for (const candidate of candidates) {
    if (isUnconditionalCandidate(candidate, conditionSetsById)) {
      continue;
    }
    const signature = conditionSignature(candidate, conditionSetsById);
    conditionalCandidatesBySignature.set(signature, [
      ...(conditionalCandidatesBySignature.get(signature) ?? []),
      candidate,
    ]);
  }
  if (conditionalCandidatesBySignature.size === 0) {
    return undefined;
  }

  const sortedDefaultCandidates = unconditionalCandidates.sort(compareCandidates);
  const defaultWinner = sortedDefaultCandidates.at(-1);
  if (!defaultWinner) {
    return undefined;
  }

  const conditionalBranches = [...conditionalCandidatesBySignature.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, conditionalCandidates]) => {
      const branchCandidates = [...unconditionalCandidates, ...conditionalCandidates].sort(
        compareCandidates,
      );
      const branchWinner = branchCandidates.at(-1);
      const branchRunnerUp = branchCandidates.at(-2);
      const branchConditionSetId = conditionalCandidates
        .map((candidate) => candidate.conditionSetId)
        .filter((conditionSetId): conditionSetId is string => Boolean(conditionSetId))
        .sort((left, right) => left.localeCompare(right))[0];
      return {
        conditionSetId: branchConditionSetId ?? "unknown-condition",
        winningCandidateId: branchWinner?.id,
        losingCandidateIds: branchWinner
          ? branchCandidates
              .filter((candidate) => candidate.id !== branchWinner.id)
              .map((candidate) => candidate.id)
          : [],
        unresolvedCandidateIds: [],
        certainty: "possible" as const,
        reason:
          branchWinner && branchRunnerUp
            ? compareCandidatesReason(branchWinner, branchRunnerUp)
            : ("source-order" as const),
      };
    });

  return {
    id: cascadeOutcomeId(defaultWinner),
    elementId: defaultWinner.elementId,
    property: defaultWinner.property,
    winningCandidateId: defaultWinner.id,
    losingCandidateIds: sortedDefaultCandidates
      .filter((candidate) => candidate.id !== defaultWinner.id)
      .map((candidate) => candidate.id),
    unresolvedCandidateIds: [],
    conditionalBranches,
    certainty: "possible",
    reason: "condition-branch",
    comparisonTrace: [
      {
        reason: "condition-branch",
        winningCandidateId: defaultWinner.id,
        certainty: "possible",
        detail:
          "Unconditional candidates form the default branch; conditional candidates are compared in separate conditional branches.",
      },
      ...conditionalBranches.map((branch) => ({
        reason: branch.reason,
        winningCandidateId: branch.winningCandidateId,
        certainty: branch.certainty,
        detail: `Conditional branch ${branch.conditionSetId} has a separate cascade winner.`,
      })),
    ],
    traces: [],
  };
}

function isUnconditionalCandidate(
  candidate: CascadeDeclarationCandidate,
  conditionSetsById: Map<string, CascadeConditionSet>,
): boolean {
  const conditionSet = candidate.conditionSetId
    ? conditionSetsById.get(candidate.conditionSetId)
    : undefined;
  return !conditionSet || conditionSet.sources.length === 0;
}

function conditionSignature(
  candidate: CascadeDeclarationCandidate,
  conditionSetsById: Map<string, CascadeConditionSet>,
): string {
  return serializeConditionSet(
    candidate.conditionSetId ? conditionSetsById.get(candidate.conditionSetId) : undefined,
  );
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
