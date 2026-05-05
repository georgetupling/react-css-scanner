import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderModel } from "../render-structure/index.js";
import { matchElementClassRequirement } from "./elementRequirementMatcher.js";
import { selectorBranchMatchId, selectorElementMatchId } from "./ids.js";
import { buildSelectorRenderMatchIndexes } from "./renderMatchIndexes.js";
import type { SelectorBranchMatch, SelectorElementMatch } from "./types.js";
import { uniqueSorted } from "./utils.js";

export type SelectorRenderMatchIndexes = ReturnType<typeof buildSelectorRenderMatchIndexes>;

const MAX_UNKNOWN_CLASS_FALLBACK_ELEMENT_IDS = 128;

export function buildElementMatchesForClassNames(input: {
  branch: SelectorBranchNode;
  classNames: string[];
  elementIds: string[];
  renderIndexes: SelectorRenderMatchIndexes;
}): SelectorElementMatch[] {
  const matches: SelectorElementMatch[] = [];
  const requiredClassNames = uniqueSorted(input.classNames);
  for (const elementId of input.elementIds) {
    const match = matchElementClassRequirement({
      indexes: input.renderIndexes,
      elementId,
      classNames: input.classNames,
    });
    if (match.certainty === "impossible") {
      continue;
    }

    matches.push({
      id: selectorElementMatchId({
        selectorBranchNodeId: input.branch.id,
        elementId,
      }),
      selectorBranchNodeId: input.branch.id,
      elementId,
      requirement: {
        requiredClassNames,
        unsupportedParts: [],
      },
      matchedClassNames: match.matchedClassNames,
      supportingEmissionSiteIds: match.supportingEmissionSiteIds,
      certainty: match.certainty,
      confidence: match.certainty === "definite" ? "high" : "medium",
    });
  }
  return matches;
}

export function buildSubjectBranchMatches(input: {
  branch: SelectorBranchNode;
  renderModel: RenderModel;
  elementMatches: SelectorElementMatch[];
}): SelectorBranchMatch[] {
  return input.elementMatches.flatMap((elementMatch) => {
    const element = input.renderModel.indexes.elementById.get(elementMatch.elementId);
    if (!element) {
      return [];
    }

    return [
      {
        id: selectorBranchMatchId({
          selectorBranchNodeId: input.branch.id,
          elementId: elementMatch.elementId,
        }),
        selectorBranchNodeId: input.branch.id,
        subjectElementId: elementMatch.elementId,
        elementMatchIds: [elementMatch.id],
        supportingEmissionSiteIds: elementMatch.supportingEmissionSiteIds,
        requiredClassNames: uniqueSorted(input.branch.subjectClassNames),
        matchedClassNames: elementMatch.matchedClassNames,
        renderPathIds: [element.renderPathId],
        placementConditionIds: uniqueSorted(element.placementConditionIds),
        certainty: elementMatch.certainty,
        confidence: elementMatch.confidence,
        traces: [],
      },
    ];
  });
}

export function getCandidateElementIds(input: {
  classNames: string[];
  elementIdsByClassName: Map<string, string[]>;
  renderIndexes: SelectorRenderMatchIndexes;
}): string[] {
  const classNames = uniqueSorted(input.classNames);
  if (classNames.length === 0) {
    return [];
  }

  const [firstClassName, ...restClassNames] = classNames;
  const unknownElementIds = input.renderIndexes.unknownClassElementIds.slice(
    0,
    MAX_UNKNOWN_CLASS_FALLBACK_ELEMENT_IDS,
  );
  let candidates = sortedUnion(
    input.elementIdsByClassName.get(firstClassName) ?? [],
    unknownElementIds,
  );
  for (const className of restClassNames) {
    const elementIds = sortedUnion(
      input.elementIdsByClassName.get(className) ?? [],
      unknownElementIds,
    );
    candidates = intersectSorted(candidates, elementIds);
    if (candidates.length === 0) {
      return [];
    }
  }

  return candidates;
}

function intersectSorted(left: string[], right: string[]): string[] {
  const result: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const comparison = left[leftIndex].localeCompare(right[rightIndex]);
    if (comparison === 0) {
      result.push(left[leftIndex]);
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    if (comparison < 0) {
      leftIndex += 1;
      continue;
    }
    rightIndex += 1;
  }
  return result;
}

function sortedUnion(left: string[], right: string[]): string[] {
  const result: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    const comparison = leftValue.localeCompare(rightValue);
    if (comparison === 0) {
      result.push(leftValue);
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    if (comparison < 0) {
      result.push(leftValue);
      leftIndex += 1;
      continue;
    }
    result.push(rightValue);
    rightIndex += 1;
  }
  while (leftIndex < left.length) {
    result.push(left[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    result.push(right[rightIndex]);
    rightIndex += 1;
  }
  return result;
}
