import { compareCandidates, compareCandidatesReason } from "./candidateComparison.js";
import {
  areAtRuleEnvironmentConditionsSatisfiable,
  evaluateEnvironmentProfilesForAtRuleContext,
} from "./environmentProfiles.js";
import { cascadeConditionSetId, cascadeOutcomeId } from "./ids.js";
import type {
  CascadeConditionalOutcomeBranch,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CascadeOutcome,
} from "./types.js";

type CandidateConditionRecord = {
  candidate: CascadeDeclarationCandidate;
  conditionSet?: CascadeConditionSet;
};

export type ModeledConditionBranchLimit = {
  conditionSetCount: number;
  branchCombinationCount: number;
  maxConditionSets: number;
  maxBranchCombinations: number;
};

export type ModeledConditionBranchResult = {
  outcome?: CascadeOutcome;
  limitExceeded?: ModeledConditionBranchLimit;
};

const MAX_MODELED_CONDITION_SETS = 8;
const MAX_MODELED_BRANCH_COMBINATIONS = 128;

export function buildModeledConditionBranchOutcome(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CascadeOutcome | undefined {
  return buildModeledConditionBranchResult(candidates, conditionSetsById).outcome;
}

export function buildModeledConditionBranchResult(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): ModeledConditionBranchResult {
  const candidateRecords = buildCandidateConditionRecords(candidates, conditionSetsById);
  const conditionalConditionSets = uniqueConditionSets(
    candidateRecords
      .map((record) => record.conditionSet)
      .filter((conditionSet): conditionSet is CascadeConditionSet =>
        Boolean(conditionSet && conditionSet.sources.length > 0),
      ),
  );
  if (conditionalConditionSets.length === 0) {
    return {};
  }
  const branchCombinationCount = countConditionSetCombinations(conditionalConditionSets.length);
  if (
    conditionalConditionSets.length > MAX_MODELED_CONDITION_SETS ||
    branchCombinationCount > MAX_MODELED_BRANCH_COMBINATIONS
  ) {
    return {
      limitExceeded: {
        conditionSetCount: conditionalConditionSets.length,
        branchCombinationCount,
        maxConditionSets: MAX_MODELED_CONDITION_SETS,
        maxBranchCombinations: MAX_MODELED_BRANCH_COMBINATIONS,
      },
    };
  }
  if (
    conditionalConditionSets.some(
      (conditionSet) =>
        conditionSet.renderConditionIds.length > 0 ||
        conditionSet.classEmissionConditionIds.length > 0 ||
        conditionSet.runtimeContextIds.length > 0,
    )
  ) {
    return {};
  }

  const branchConditionSets = buildModeledBranchConditionSets(
    conditionalConditionSets,
    conditionSetsById,
  );
  if (branchConditionSets.length === 0) {
    return {};
  }

  const defaultCandidates = candidateRecords
    .filter((record) => !record.conditionSet || record.conditionSet.sources.length === 0)
    .map((record) => record.candidate)
    .sort(compareCandidates);
  const defaultWinner = defaultCandidates.at(-1);
  const fallbackWinner = defaultWinner ?? candidates.slice().sort(compareCandidates).at(-1);
  if (!fallbackWinner) {
    return {};
  }

  const conditionalBranches = branchConditionSets
    .map((branchConditionSet) => buildConditionalBranch(candidateRecords, branchConditionSet))
    .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch));
  if (conditionalBranches.length === 0) {
    return {};
  }

  return {
    outcome: {
      id: cascadeOutcomeId(fallbackWinner),
      elementId: fallbackWinner.elementId,
      property: fallbackWinner.property,
      ...(defaultWinner ? { winningCandidateId: defaultWinner.id } : {}),
      losingCandidateIds: defaultWinner
        ? defaultCandidates
            .filter((candidate) => candidate.id !== defaultWinner.id)
            .map((candidate) => candidate.id)
        : [],
      unresolvedCandidateIds: [],
      conditionalBranches,
      certainty: "possible",
      reason: "condition-branch",
      comparisonTrace: [
        {
          reason: "condition-branch",
          ...(defaultWinner ? { winningCandidateId: defaultWinner.id } : {}),
          certainty: "possible",
          detail:
            "Modeled conditional contexts are reduced into separate possible cascade branches, including overlapping media and selector-state contexts.",
        },
        ...conditionalBranches.map((branch) => ({
          reason: branch.reason,
          winningCandidateId: branch.winningCandidateId,
          certainty: branch.certainty,
          detail: `Conditional branch ${branch.conditionSetId} has a separate modeled cascade winner.`,
        })),
      ],
      traces: [],
    },
  };
}

export function buildPseudoStateBranchOutcome(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CascadeOutcome | undefined {
  const candidateRecords = buildCandidateConditionRecords(candidates, conditionSetsById);
  const baseSignatures = new Set(
    candidateRecords.map((record) => serializeConditionSetWithoutPseudoStates(record.conditionSet)),
  );
  if (baseSignatures.size !== 1) {
    return undefined;
  }

  const pseudoStateSignatures = new Set(
    candidateRecords.map((record) => pseudoStateSignature(record.conditionSet)),
  );
  if (pseudoStateSignatures.size < 2) {
    return undefined;
  }

  const branchConditionSets = candidateRecords
    .map((record) => record.conditionSet)
    .filter((conditionSet): conditionSet is CascadeConditionSet =>
      Boolean(conditionSet && conditionSet.pseudoStates.length > 0),
    )
    .sort((left, right) => pseudoStateSignature(left).localeCompare(pseudoStateSignature(right)));
  if (branchConditionSets.length === 0) {
    return undefined;
  }

  const defaultCandidates = candidateRecords
    .filter((record) => (record.conditionSet?.pseudoStates.length ?? 0) === 0)
    .map((record) => record.candidate)
    .sort(compareCandidates);
  const defaultWinner = defaultCandidates.at(-1);
  const fallbackWinner = defaultWinner ?? candidates.slice().sort(compareCandidates).at(-1);
  if (!fallbackWinner) {
    return undefined;
  }

  const conditionalBranches = uniqueConditionSetsByPseudoSignature(branchConditionSets).map(
    (branchConditionSet) => {
      const branchCandidates = candidateRecords
        .filter((record) =>
          conditionSetAppliesInPseudoStateBranch(record.conditionSet, branchConditionSet),
        )
        .map((record) => record.candidate)
        .sort(compareCandidates);
      const branchWinner = branchCandidates.at(-1);
      const branchRunnerUp = branchCandidates.at(-2);
      return {
        conditionSetId: branchConditionSet.id,
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
    },
  );

  return {
    id: cascadeOutcomeId(fallbackWinner),
    elementId: fallbackWinner.elementId,
    property: fallbackWinner.property,
    ...(defaultWinner ? { winningCandidateId: defaultWinner.id } : {}),
    losingCandidateIds: defaultWinner
      ? defaultCandidates
          .filter((candidate) => candidate.id !== defaultWinner.id)
          .map((candidate) => candidate.id)
      : [],
    unresolvedCandidateIds: [],
    conditionalBranches,
    certainty: "possible",
    reason: "condition-branch",
    comparisonTrace: [
      {
        reason: "condition-branch",
        ...(defaultWinner ? { winningCandidateId: defaultWinner.id } : {}),
        certainty: "possible",
        detail:
          "Selector pseudo-state conditions are reduced into branch contexts using modeled pseudo-state implication.",
      },
      ...conditionalBranches.map((branch) => ({
        reason: branch.reason,
        winningCandidateId: branch.winningCandidateId,
        certainty: branch.certainty,
        detail: `Conditional branch ${branch.conditionSetId} includes candidates implied by that pseudo-state context.`,
      })),
    ],
    traces: [],
  };
}

function buildCandidateConditionRecords(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CandidateConditionRecord[] {
  return candidates.map((candidate) => ({
    candidate,
    conditionSet: candidate.conditionSetId
      ? conditionSetsById.get(candidate.conditionSetId)
      : undefined,
  }));
}

function buildConditionalBranch(
  candidateRecords: CandidateConditionRecord[],
  branchConditionSet: CascadeConditionSet,
): CascadeConditionalOutcomeBranch | undefined {
  const branchCandidates = candidateRecords
    .filter((record) => conditionSetAppliesInBranch(record.conditionSet, branchConditionSet))
    .map((record) => record.candidate)
    .sort(compareCandidates);
  const branchWinner = branchCandidates.at(-1);
  if (!branchWinner) {
    return undefined;
  }
  const branchRunnerUp = branchCandidates.at(-2);
  const environmentProfileIds = evaluateEnvironmentProfilesForAtRuleContext(
    branchConditionSet.atRuleContext,
  ).profileIds;
  return {
    conditionSetId: branchConditionSet.id,
    winningCandidateId: branchWinner.id,
    losingCandidateIds: branchCandidates
      .filter((candidate) => candidate.id !== branchWinner.id)
      .map((candidate) => candidate.id),
    unresolvedCandidateIds: [],
    ...(environmentProfileIds.length > 0 ? { environmentProfileIds } : {}),
    certainty: "possible",
    reason: branchRunnerUp ? compareCandidatesReason(branchWinner, branchRunnerUp) : "source-order",
  };
}

function buildModeledBranchConditionSets(
  conditionSets: CascadeConditionSet[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CascadeConditionSet[] {
  const branchesById = new Map<string, CascadeConditionSet>();
  for (const combination of conditionSetCombinations(conditionSets)) {
    const merged = mergeConditionSets(combination);
    if (!merged || !areAtRuleConditionsSatisfiable(merged.atRuleContext)) {
      continue;
    }
    branchesById.set(merged.id, merged);
    conditionSetsById.set(merged.id, merged);
  }
  return [...branchesById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function conditionSetCombinations(conditionSets: CascadeConditionSet[]): CascadeConditionSet[][] {
  const combinations: CascadeConditionSet[][] = [];
  const total = 2 ** conditionSets.length;
  for (let mask = 1; mask < total; mask += 1) {
    const combination: CascadeConditionSet[] = [];
    for (let index = 0; index < conditionSets.length; index += 1) {
      if ((mask & (1 << index)) !== 0) {
        const conditionSet = conditionSets[index];
        if (conditionSet) {
          combination.push(conditionSet);
        }
      }
    }
    combinations.push(combination);
  }
  return combinations.sort((left, right) => {
    const sizeComparison = left.length - right.length;
    if (sizeComparison !== 0) {
      return sizeComparison;
    }
    return left
      .map((conditionSet) => conditionSet.id)
      .join("|")
      .localeCompare(right.map((conditionSet) => conditionSet.id).join("|"));
  });
}

function countConditionSetCombinations(conditionSetCount: number): number {
  return 2 ** conditionSetCount - 1;
}

function mergeConditionSets(conditionSets: CascadeConditionSet[]): CascadeConditionSet | undefined {
  const atRuleContext = uniqueAtRuleContext(
    conditionSets.flatMap((conditionSet) => conditionSet.atRuleContext),
  );
  const pseudoStates = canonicalizePseudoStates(
    conditionSets.flatMap((conditionSet) => conditionSet.pseudoStates),
  );
  const renderConditionIds = uniqueSorted(
    conditionSets.flatMap((conditionSet) => conditionSet.renderConditionIds),
  );
  const classEmissionConditionIds = uniqueSorted(
    conditionSets.flatMap((conditionSet) => conditionSet.classEmissionConditionIds),
  );
  const runtimeContextIds = uniqueSorted(
    conditionSets.flatMap((conditionSet) => conditionSet.runtimeContextIds),
  );
  const sources = uniqueSorted(
    conditionSets.flatMap((conditionSet) => conditionSet.sources),
  ) as CascadeConditionSet["sources"];
  if (sources.length === 0) {
    return undefined;
  }

  const conditionSet: Omit<CascadeConditionSet, "id"> = {
    sources,
    atRuleContext,
    renderConditionIds,
    classEmissionConditionIds,
    pseudoStates,
    runtimeContextIds,
    compatibility: "conditional",
    reasons: ["modeled branch condition combines simultaneously satisfiable conditional contexts"],
    traces: [],
  };
  return {
    id: cascadeConditionSetId(conditionSet),
    ...conditionSet,
  };
}

function serializeConditionSetWithoutPseudoStates(
  conditionSet: CascadeConditionSet | undefined,
): string {
  return JSON.stringify({
    atRuleContext: conditionSet?.atRuleContext ?? [],
    renderConditionIds: conditionSet?.renderConditionIds ?? [],
    classEmissionConditionIds: conditionSet?.classEmissionConditionIds ?? [],
    runtimeContextIds: conditionSet?.runtimeContextIds ?? [],
  });
}

function pseudoStateSignature(conditionSet: CascadeConditionSet | undefined): string {
  return JSON.stringify(conditionSet?.pseudoStates ?? []);
}

function uniqueConditionSetsByPseudoSignature(
  conditionSets: CascadeConditionSet[],
): CascadeConditionSet[] {
  const bySignature = new Map<string, CascadeConditionSet>();
  for (const conditionSet of conditionSets) {
    const signature = pseudoStateSignature(conditionSet);
    if (!bySignature.has(signature)) {
      bySignature.set(signature, conditionSet);
    }
  }
  return [...bySignature.values()];
}

function conditionSetAppliesInPseudoStateBranch(
  candidateConditionSet: CascadeConditionSet | undefined,
  branchConditionSet: CascadeConditionSet,
): boolean {
  const candidateStates = candidateConditionSet?.pseudoStates ?? [];
  if (candidateStates.length === 0) {
    return true;
  }

  const branchStateClosure = expandPseudoStateImplications(branchConditionSet.pseudoStates);
  return candidateStates.every((state) => branchStateClosure.has(state));
}

function conditionSetAppliesInBranch(
  candidateConditionSet: CascadeConditionSet | undefined,
  branchConditionSet: CascadeConditionSet,
): boolean {
  if (!candidateConditionSet || candidateConditionSet.sources.length === 0) {
    return true;
  }
  if (!conditionSetAppliesInPseudoStateBranch(candidateConditionSet, branchConditionSet)) {
    return false;
  }
  return (
    isAtRuleContextSubset(candidateConditionSet.atRuleContext, branchConditionSet.atRuleContext) &&
    isStringSubset(
      candidateConditionSet.renderConditionIds,
      branchConditionSet.renderConditionIds,
    ) &&
    isStringSubset(
      candidateConditionSet.classEmissionConditionIds,
      branchConditionSet.classEmissionConditionIds,
    ) &&
    isStringSubset(candidateConditionSet.runtimeContextIds, branchConditionSet.runtimeContextIds)
  );
}

function isAtRuleContextSubset(
  candidateAtRules: CascadeConditionSet["atRuleContext"],
  branchAtRules: CascadeConditionSet["atRuleContext"],
): boolean {
  return candidateAtRules.every((candidateAtRule) =>
    branchAtRules.some(
      (branchAtRule) =>
        branchAtRule.name === candidateAtRule.name &&
        branchAtRule.params === candidateAtRule.params,
    ),
  );
}

function isStringSubset(needles: string[], haystack: string[]): boolean {
  const values = new Set(haystack);
  return needles.every((needle) => values.has(needle));
}

function areAtRuleConditionsSatisfiable(
  atRuleContext: CascadeConditionSet["atRuleContext"],
): boolean {
  return areAtRuleEnvironmentConditionsSatisfiable(atRuleContext);
}

function expandPseudoStateImplications(pseudoStates: string[]): Set<string> {
  const expanded = new Set(pseudoStates);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of [...expanded]) {
      for (const impliedState of PSEUDO_STATE_IMPLICATIONS.get(state) ?? []) {
        if (!expanded.has(impliedState)) {
          expanded.add(impliedState);
          changed = true;
        }
      }
    }
  }
  return expanded;
}

const PSEUDO_STATE_IMPLICATIONS = new Map<string, string[]>([
  ["focus-visible", ["focus"]],
  ["user-invalid", ["invalid"]],
  ["user-valid", ["valid"]],
]);

function canonicalizePseudoStates(pseudoStates: string[]): string[] {
  const uniqueStates = uniqueSorted(pseudoStates);
  return uniqueStates.filter((state) =>
    uniqueStates.every(
      (otherState) =>
        otherState === state || !expandPseudoStateImplications([otherState]).has(state),
    ),
  );
}

function uniqueConditionSets(conditionSets: CascadeConditionSet[]): CascadeConditionSet[] {
  const byId = new Map<string, CascadeConditionSet>();
  for (const conditionSet of conditionSets) {
    byId.set(conditionSet.id, conditionSet);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueAtRuleContext(
  atRuleContext: CascadeConditionSet["atRuleContext"],
): CascadeConditionSet["atRuleContext"] {
  const byKey = new Map<string, { name: string; params: string }>();
  for (const entry of atRuleContext) {
    byKey.set(`${entry.name}\0${entry.params}`, entry);
  }
  return [...byKey.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.params.localeCompare(right.params),
  );
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
