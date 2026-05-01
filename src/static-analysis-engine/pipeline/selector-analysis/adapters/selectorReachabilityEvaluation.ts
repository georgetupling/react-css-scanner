import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorReachabilityEvidence,
} from "../types.js";
import { selectorBranchSourceKey } from "../../selector-reachability/index.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
} from "../../selector-reachability/index.js";

export type SelectorReachabilityMatchEvaluation = {
  branch: SelectorBranchReachability;
  matches: SelectorBranchMatch[];
  matchedTargets: SelectorAnalysisTarget[];
  hasDefiniteMatch: boolean;
  hasPossibleMatch: boolean;
  hasUnknownContextMatch: boolean;
};

export function evaluateSelectorReachabilityEvidence(input: {
  selectorQuery: ParsedSelectorQuery;
  analysisTargets: SelectorAnalysisTarget[];
  selectorReachability?: SelectorReachabilityEvidence;
}): SelectorReachabilityMatchEvaluation | undefined {
  if (!input.selectorReachability || input.selectorQuery.source.kind !== "css-source") {
    return undefined;
  }

  const sourceKey = selectorBranchSourceKey({
    ruleKey: input.selectorQuery.source.ruleKey,
    branchIndex: input.selectorQuery.source.branchIndex,
    selectorText: input.selectorQuery.selectorText,
    location: input.selectorQuery.source.selectorAnchor,
  });
  const branch = input.selectorReachability.indexes.branchReachabilityBySourceKey.get(sourceKey);
  if (!branch) {
    return undefined;
  }

  const scopedElementIds = new Map<string, SelectorAnalysisTarget[]>();
  for (const target of input.analysisTargets) {
    for (const elementId of target.elementIds) {
      const targets = scopedElementIds.get(elementId) ?? [];
      targets.push(target);
      scopedElementIds.set(elementId, targets);
    }
  }

  const matches = branch.matchIds
    .map((matchId) => input.selectorReachability?.indexes.matchById.get(matchId))
    .filter((match): match is SelectorBranchMatch => Boolean(match))
    .filter((match) => scopedElementIds.has(match.subjectElementId));
  const matchedTargets = uniqueTargets(
    matches.flatMap((match) => scopedElementIds.get(match.subjectElementId) ?? []),
  );

  return {
    branch,
    matches,
    matchedTargets,
    hasDefiniteMatch:
      matches.some((match) => match.certainty === "definite") &&
      matchedTargets.some((target) => target.reachabilityAvailability === "definite"),
    hasPossibleMatch:
      matches.some((match) => match.certainty === "possible") ||
      matchedTargets.some((target) => target.reachabilityAvailability === "possible"),
    hasUnknownContextMatch: matches.some((match) => match.certainty === "unknown-context"),
  };
}

function uniqueTargets(targets: SelectorAnalysisTarget[]): SelectorAnalysisTarget[] {
  const byId = new Map<string, SelectorAnalysisTarget>();
  for (const target of targets) {
    byId.set(target.targetId, target);
  }
  return [...byId.values()].sort((left, right) => left.targetId.localeCompare(right.targetId));
}
