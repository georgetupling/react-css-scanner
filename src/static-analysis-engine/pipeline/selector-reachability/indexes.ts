import type { SelectorBranchNode } from "../fact-graph/index.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorElementMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityIndexes,
} from "./types.js";
import { anchorKey } from "./utils.js";

export function buildIndexes(input: {
  selectorBranches: SelectorBranchReachability[];
  elementMatches: SelectorElementMatch[];
  branchMatches: SelectorBranchMatch[];
  diagnostics: SelectorReachabilityDiagnostic[];
}): SelectorReachabilityIndexes {
  const branchReachabilityBySelectorBranchNodeId = new Map<string, SelectorBranchReachability>();
  const branchReachabilityBySourceKey = new Map<string, SelectorBranchReachability>();
  const matchById = new Map<string, SelectorBranchMatch>();
  const elementMatchById = new Map<string, SelectorElementMatch>();
  const matchIdsBySelectorBranchNodeId = new Map<string, string[]>();
  const matchIdsByElementId = new Map<string, string[]>();
  const matchIdsByClassName = new Map<string, string[]>();
  const branchIdsByRequiredClassName = new Map<string, string[]>();
  const branchIdsByStylesheetNodeId = new Map<string, string[]>();
  const diagnosticIdsBySelectorBranchNodeId = new Map<string, string[]>();

  for (const branch of input.selectorBranches) {
    branchReachabilityBySelectorBranchNodeId.set(branch.selectorBranchNodeId, branch);
    branchReachabilityBySourceKey.set(selectorBranchSourceKeyFromReachability(branch), branch);

    for (const className of branch.subject.requiredClassNames) {
      pushMapValue(branchIdsByRequiredClassName, className, branch.selectorBranchNodeId);
    }

    if (branch.stylesheetNodeId) {
      pushMapValue(
        branchIdsByStylesheetNodeId,
        branch.stylesheetNodeId,
        branch.selectorBranchNodeId,
      );
    }
  }

  for (const elementMatch of input.elementMatches) {
    elementMatchById.set(elementMatch.id, elementMatch);
  }

  for (const match of input.branchMatches) {
    matchById.set(match.id, match);
    pushMapValue(matchIdsBySelectorBranchNodeId, match.selectorBranchNodeId, match.id);
    pushMapValue(matchIdsByElementId, match.subjectElementId, match.id);
    for (const className of match.requiredClassNames) {
      pushMapValue(matchIdsByClassName, className, match.id);
    }
  }

  for (const diagnostic of input.diagnostics) {
    pushMapValue(
      diagnosticIdsBySelectorBranchNodeId,
      diagnostic.selectorBranchNodeId,
      diagnostic.id,
    );
  }

  [
    matchIdsBySelectorBranchNodeId,
    matchIdsByElementId,
    matchIdsByClassName,
    branchIdsByRequiredClassName,
    branchIdsByStylesheetNodeId,
    diagnosticIdsBySelectorBranchNodeId,
  ].forEach(sortMapValues);

  return {
    branchReachabilityBySelectorBranchNodeId,
    branchReachabilityBySourceKey,
    matchById,
    elementMatchById,
    matchIdsBySelectorBranchNodeId,
    matchIdsByElementId,
    matchIdsByClassName,
    branchIdsByRequiredClassName,
    branchIdsByStylesheetNodeId,
    diagnosticIdsBySelectorBranchNodeId,
  };
}

export function compareSelectorBranches(
  left: SelectorBranchNode,
  right: SelectorBranchNode,
): number {
  return (
    (left.location?.filePath ?? "").localeCompare(right.location?.filePath ?? "") ||
    (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0) ||
    (left.location?.startColumn ?? 0) - (right.location?.startColumn ?? 0) ||
    left.ruleKey.localeCompare(right.ruleKey) ||
    left.branchIndex - right.branchIndex ||
    left.id.localeCompare(right.id)
  );
}

function selectorBranchSourceKeyFromReachability(branch: SelectorBranchReachability): string {
  return [
    branch.ruleKey,
    branch.branchIndex,
    branch.branchText,
    branch.location ? anchorKey(branch.location) : "",
  ].join(":");
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
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
