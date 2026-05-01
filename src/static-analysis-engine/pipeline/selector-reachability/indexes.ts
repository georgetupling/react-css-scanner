import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderModel } from "../render-structure/index.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorElementMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityIndexes,
} from "./types.js";
import { anchorKey } from "./utils.js";

export function buildIndexes(input: {
  renderModel: RenderModel;
  selectorBranches: SelectorBranchReachability[];
  elementMatches: SelectorElementMatch[];
  branchMatches: SelectorBranchMatch[];
  diagnostics: SelectorReachabilityDiagnostic[];
}): SelectorReachabilityIndexes {
  const branchReachabilityBySelectorBranchNodeId = new Map<string, SelectorBranchReachability>();
  const branchReachabilityBySourceKey = new Map<string, SelectorBranchReachability>();
  const matchById = new Map<string, SelectorBranchMatch>();
  const elementMatchById = new Map<string, SelectorElementMatch>();
  const renderElementById = input.renderModel.indexes.elementById;
  const emissionSiteById = input.renderModel.indexes.emissionSiteById;
  const renderPathById = input.renderModel.indexes.renderPathById;
  const unknownRegionById = new Map<string, (typeof input.renderModel.renderRegions)[number]>();
  const matchIdsBySelectorBranchNodeId = new Map<string, string[]>();
  const matchIdsByElementId = new Map<string, string[]>();
  const matchIdsByClassName = new Map<string, string[]>();
  const matchIdsByEmissionSiteId = new Map<string, string[]>();
  const matchIdsByRenderPathId = new Map<string, string[]>();
  const matchIdsByPlacementConditionId = new Map<string, string[]>();
  const renderPathIdsByElementId = new Map<string, string[]>();
  const renderPathIdsByEmissionSiteId = new Map<string, string[]>();
  const placementConditionIdsByElementId = new Map<string, string[]>();
  const placementConditionIdsByEmissionSiteId = new Map<string, string[]>();
  const emissionSiteIdsByElementId = input.renderModel.indexes.emissionSiteIdsByElementId;
  const emissionSiteIdsByToken = input.renderModel.indexes.emissionSiteIdsByToken;
  const unknownClassElementIds: string[] = [];
  const unknownClassEmissionSiteIds: string[] = [];
  const unknownClassEmissionSiteIdsByElementId = new Map<string, string[]>();
  const unknownRegionIdsByComponentNodeId = new Map<string, string[]>();
  const unknownRegionIdsByRenderPathId = new Map<string, string[]>();
  const branchIdsByRequiredClassName = new Map<string, string[]>();
  const branchIdsByStylesheetNodeId = new Map<string, string[]>();
  const diagnosticIdsBySelectorBranchNodeId = new Map<string, string[]>();

  for (const element of input.renderModel.elements) {
    pushMapValue(renderPathIdsByElementId, element.id, element.renderPathId);
    for (const placementConditionId of element.placementConditionIds) {
      pushMapValue(placementConditionIdsByElementId, element.id, placementConditionId);
    }
  }

  for (const emissionSite of input.renderModel.emissionSites) {
    pushMapValue(renderPathIdsByEmissionSiteId, emissionSite.id, emissionSite.renderPathId);
    for (const placementConditionId of emissionSite.placementConditionIds) {
      pushMapValue(placementConditionIdsByEmissionSiteId, emissionSite.id, placementConditionId);
    }

    if (emissionSite.confidence === "low" || emissionSite.unsupported.length > 0) {
      unknownClassEmissionSiteIds.push(emissionSite.id);
      if (emissionSite.elementId) {
        unknownClassElementIds.push(emissionSite.elementId);
        pushMapValue(
          unknownClassEmissionSiteIdsByElementId,
          emissionSite.elementId,
          emissionSite.id,
        );
      }
    }
  }

  for (const region of input.renderModel.renderRegions) {
    if (region.regionKind !== "unknown-barrier") {
      continue;
    }
    unknownRegionById.set(region.id, region);
    if (region.componentNodeId) {
      pushMapValue(unknownRegionIdsByComponentNodeId, region.componentNodeId, region.id);
    }
    pushMapValue(unknownRegionIdsByRenderPathId, region.renderPathId, region.id);
  }

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
    for (const emissionSiteId of match.supportingEmissionSiteIds) {
      pushMapValue(matchIdsByEmissionSiteId, emissionSiteId, match.id);
    }
    for (const renderPathId of match.renderPathIds) {
      pushMapValue(matchIdsByRenderPathId, renderPathId, match.id);
    }
    for (const placementConditionId of match.placementConditionIds) {
      pushMapValue(matchIdsByPlacementConditionId, placementConditionId, match.id);
    }
  }

  for (const diagnostic of input.diagnostics) {
    pushMapValue(
      diagnosticIdsBySelectorBranchNodeId,
      diagnostic.selectorBranchNodeId,
      diagnostic.id,
    );
  }

  dedupeAndSortMapValues(matchIdsBySelectorBranchNodeId);
  dedupeAndSortMapValues(matchIdsByElementId);
  dedupeAndSortMapValues(matchIdsByClassName);
  dedupeAndSortMapValues(matchIdsByEmissionSiteId);
  dedupeAndSortMapValues(matchIdsByRenderPathId);
  dedupeAndSortMapValues(matchIdsByPlacementConditionId);
  dedupeAndSortMapValues(renderPathIdsByElementId);
  dedupeAndSortMapValues(renderPathIdsByEmissionSiteId);
  dedupeAndSortMapValues(placementConditionIdsByElementId);
  dedupeAndSortMapValues(placementConditionIdsByEmissionSiteId);
  dedupeAndSortMapValues(unknownClassEmissionSiteIdsByElementId);
  dedupeAndSortMapValues(unknownRegionIdsByComponentNodeId);
  dedupeAndSortMapValues(unknownRegionIdsByRenderPathId);
  dedupeAndSortMapValues(branchIdsByRequiredClassName);
  dedupeAndSortMapValues(branchIdsByStylesheetNodeId);
  dedupeAndSortMapValues(diagnosticIdsBySelectorBranchNodeId);

  return {
    branchReachabilityBySelectorBranchNodeId,
    branchReachabilityBySourceKey,
    matchById,
    elementMatchById,
    renderElementById,
    emissionSiteById,
    renderPathById,
    unknownRegionById,
    matchIdsBySelectorBranchNodeId,
    matchIdsByElementId,
    matchIdsByClassName,
    matchIdsByEmissionSiteId,
    matchIdsByRenderPathId,
    matchIdsByPlacementConditionId,
    renderPathIdsByElementId,
    renderPathIdsByEmissionSiteId,
    placementConditionIdsByElementId,
    placementConditionIdsByEmissionSiteId,
    emissionSiteIdsByElementId,
    emissionSiteIdsByToken,
    unknownClassElementIds: uniqueSorted(unknownClassElementIds),
    unknownClassEmissionSiteIds: uniqueSorted(unknownClassEmissionSiteIds),
    unknownClassEmissionSiteIdsByElementId,
    unknownRegionIdsByComponentNodeId,
    unknownRegionIdsByRenderPathId,
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
  const values = map.get(key);
  if (values) {
    values.push(value);
    return;
  }
  map.set(key, [value]);
}

function dedupeAndSortMapValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    if (values.length < 2) {
      continue;
    }
    values.sort(compareStrings);
    dedupeSortedInPlace(values);
    map.set(key, values);
  }
}

function uniqueSorted(values: string[]): string[] {
  if (values.length < 2) {
    return values.length === 0 ? [] : [values[0]];
  }
  const sorted = [...values].sort(compareStrings);
  dedupeSortedInPlace(sorted);
  return sorted;
}

function dedupeSortedInPlace(values: string[]): void {
  if (values.length < 2) {
    return;
  }
  let writeIndex = 1;
  for (let readIndex = 1; readIndex < values.length; readIndex += 1) {
    if (values[readIndex] !== values[writeIndex - 1]) {
      values[writeIndex] = values[readIndex];
      writeIndex += 1;
    }
  }
  values.length = writeIndex;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
