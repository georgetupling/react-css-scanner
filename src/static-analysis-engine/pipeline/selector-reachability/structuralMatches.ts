import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderModel } from "../render-structure/index.js";
import { matchElementClassRequirement } from "./elementRequirementMatcher.js";
import { selectorBranchMatchId, selectorElementMatchId } from "./ids.js";
import { getCandidateElementIds, type SelectorRenderMatchIndexes } from "./subjectMatches.js";
import type {
  SelectorBranchMatch,
  SelectorBranchRequirement,
  SelectorElementMatch,
} from "./types.js";
import { uniqueSorted } from "./utils.js";

export type StructuralConstraint = {
  combinator: "descendant" | "child" | "adjacent-sibling" | "general-sibling";
  leftClassName: string;
  rightClassName: string;
};

export type StructuralRelationIndexes = {
  childIndexByElementId: Map<string, number>;
  adjacentLeftSiblingIdByElementId: Map<string, string>;
  precedingSiblingIdsByElementId: Map<string, string[]>;
  repeatedSiblingCandidateByElementId: Map<string, boolean>;
  elementBitsetIndex: {
    indexByElementId: Map<string, number>;
    elementIdByIndex: string[];
    wordCount: number;
  };
  ancestorBitsByElementId: Map<string, Uint32Array>;
  precedingSiblingBitsByElementId: Map<string, Uint32Array>;
};

export type StructuralMatchContext = {
  classMatchCache: Map<string, CachedClassMatch[]>;
  constraintJoinCache: Map<string, Map<string, string[]>>;
};

type CachedClassMatch = {
  elementId: string;
  supportingEmissionSiteIds: string[];
  matchedClassNames: string[];
  certainty: SelectorElementMatch["certainty"];
  confidence: SelectorElementMatch["confidence"];
};

export function createStructuralMatchContext(): StructuralMatchContext {
  return {
    classMatchCache: new Map(),
    constraintJoinCache: new Map(),
  };
}

export function projectStructuralConstraintFromRequirement(
  requirement: SelectorBranchRequirement,
): StructuralConstraint | undefined {
  if (requirement.kind === "ancestor-descendant") {
    return {
      combinator: "descendant",
      leftClassName: requirement.ancestorClassName,
      rightClassName: requirement.subjectClassName,
    };
  }

  if (requirement.kind === "parent-child") {
    return {
      combinator: "child",
      leftClassName: requirement.parentClassName,
      rightClassName: requirement.childClassName,
    };
  }

  if (requirement.kind !== "sibling") {
    return undefined;
  }

  return {
    combinator: requirement.relation === "adjacent" ? "adjacent-sibling" : "general-sibling",
    leftClassName: requirement.leftClassName,
    rightClassName: requirement.rightClassName,
  };
}

export function buildStructuralMatches(input: {
  branch: SelectorBranchNode;
  constraint: StructuralConstraint;
  renderModel: RenderModel;
  renderIndexes: SelectorRenderMatchIndexes;
  structuralRelationIndexes?: StructuralRelationIndexes;
  context?: StructuralMatchContext;
}): { elementMatches: SelectorElementMatch[]; branchMatches: SelectorBranchMatch[] } {
  const structuralRelationIndexes =
    input.structuralRelationIndexes ?? buildStructuralRelationIndexes(input.renderModel);
  const context = input.context ?? createStructuralMatchContext();

  const requiredClassNames = uniqueSorted([
    input.constraint.leftClassName,
    input.constraint.rightClassName,
  ]);

  const leftMatches = getClassMatches({
    branch: input.branch,
    className: input.constraint.leftClassName,
    renderIndexes: input.renderIndexes,
    context,
  });
  const rightMatches =
    input.constraint.leftClassName === input.constraint.rightClassName
      ? leftMatches
      : getClassMatches({
          branch: input.branch,
          className: input.constraint.rightClassName,
          renderIndexes: input.renderIndexes,
          context,
        });
  const leftMatchByElementId = new Map(leftMatches.map((match) => [match.elementId, match]));

  const relationByRightElementId = getConstraintJoinMap({
    constraint: input.constraint,
    leftMatches,
    rightMatches,
    renderModel: input.renderModel,
    structuralRelationIndexes,
    context,
  });

  const branchMatches: SelectorBranchMatch[] = [];
  for (const rightMatch of rightMatches) {
    const rightElement = input.renderModel.indexes.elementById.get(rightMatch.elementId);
    if (!rightElement) {
      continue;
    }

    for (const leftElementId of relationByRightElementId.get(rightMatch.elementId) ?? []) {
      const leftMatch = leftMatchByElementId.get(leftElementId);
      if (!leftMatch) {
        continue;
      }

      const leftElement = input.renderModel.indexes.elementById.get(leftElementId);
      if (!leftElement) {
        continue;
      }

      const certainty = combineCertainty(leftMatch.certainty, rightMatch.certainty);
      const leftFirstElementMatchId = leftMatch.id < rightMatch.id ? leftMatch.id : rightMatch.id;
      const rightSecondElementMatchId = leftMatch.id < rightMatch.id ? rightMatch.id : leftMatch.id;
      branchMatches.push({
        id: selectorBranchMatchId({
          selectorBranchNodeId: input.branch.id,
          elementId: `${leftMatch.elementId}:${rightMatch.elementId}`,
        }),
        selectorBranchNodeId: input.branch.id,
        subjectElementId: rightMatch.elementId,
        elementMatchIds: [leftFirstElementMatchId, rightSecondElementMatchId],
        supportingEmissionSiteIds: mergeUniqueSortedStrings(
          leftMatch.supportingEmissionSiteIds,
          rightMatch.supportingEmissionSiteIds,
        ),
        requiredClassNames,
        matchedClassNames: mergeUniqueSortedStrings(
          leftMatch.matchedClassNames,
          rightMatch.matchedClassNames,
        ),
        renderPathIds:
          leftElement.renderPathId === rightElement.renderPathId
            ? [leftElement.renderPathId]
            : leftElement.renderPathId < rightElement.renderPathId
              ? [leftElement.renderPathId, rightElement.renderPathId]
              : [rightElement.renderPathId, leftElement.renderPathId],
        placementConditionIds: mergeUniqueSortedStrings(
          leftElement.placementConditionIds,
          rightElement.placementConditionIds,
        ),
        certainty,
        confidence: certainty === "definite" ? "high" : "medium",
        traces: [],
      });
    }

    if (
      isRepeatedSiblingCandidate({
        combinator: input.constraint.combinator,
        rightElementId: rightMatch.elementId,
        leftMatchByElementId,
        structuralRelationIndexes,
      })
    ) {
      const repeatedLeftMatch = leftMatchByElementId.get(rightMatch.elementId);
      if (!repeatedLeftMatch) {
        continue;
      }

      branchMatches.push({
        id: selectorBranchMatchId({
          selectorBranchNodeId: input.branch.id,
          elementId: `${rightMatch.elementId}:${rightMatch.elementId}:repeated`,
        }),
        selectorBranchNodeId: input.branch.id,
        subjectElementId: rightMatch.elementId,
        elementMatchIds: [repeatedLeftMatch.id, rightMatch.id].sort(compareStrings),
        supportingEmissionSiteIds: mergeUniqueSortedStrings(
          repeatedLeftMatch.supportingEmissionSiteIds,
          rightMatch.supportingEmissionSiteIds,
        ),
        requiredClassNames,
        matchedClassNames: mergeUniqueSortedStrings(
          repeatedLeftMatch.matchedClassNames,
          rightMatch.matchedClassNames,
        ),
        renderPathIds: [rightElement.renderPathId],
        placementConditionIds: rightElement.placementConditionIds,
        certainty: "possible",
        confidence: "medium",
        traces: [],
      });
    }
  }

  return {
    elementMatches: deduplicateElementMatches([...leftMatches, ...rightMatches]),
    branchMatches: branchMatches.sort((left, right) => compareStrings(left.id, right.id)),
  };
}

function isRepeatedSiblingCandidate(input: {
  combinator: StructuralConstraint["combinator"];
  rightElementId: string;
  leftMatchByElementId: Map<string, SelectorElementMatch>;
  structuralRelationIndexes: StructuralRelationIndexes;
}): boolean {
  return (
    (input.combinator === "adjacent-sibling" || input.combinator === "general-sibling") &&
    input.structuralRelationIndexes.repeatedSiblingCandidateByElementId.get(
      input.rightElementId,
    ) === true &&
    input.leftMatchByElementId.has(input.rightElementId)
  );
}

function getClassMatches(input: {
  branch: SelectorBranchNode;
  className: string;
  renderIndexes: SelectorRenderMatchIndexes;
  context: StructuralMatchContext;
}): SelectorElementMatch[] {
  const cached = getCachedClassMatches(input);
  return cached.map((match) => ({
    id: selectorElementMatchId({
      selectorBranchNodeId: input.branch.id,
      elementId: match.elementId,
    }),
    selectorBranchNodeId: input.branch.id,
    elementId: match.elementId,
    requirement: {
      requiredClassNames: [input.className],
      unsupportedParts: [],
    },
    matchedClassNames: match.matchedClassNames,
    supportingEmissionSiteIds: match.supportingEmissionSiteIds,
    certainty: match.certainty,
    confidence: match.confidence,
  }));
}

function getCachedClassMatches(input: {
  className: string;
  renderIndexes: SelectorRenderMatchIndexes;
  context: StructuralMatchContext;
}): CachedClassMatch[] {
  const existing = input.context.classMatchCache.get(input.className);
  if (existing) {
    return existing;
  }

  const elementIds = getCandidateElementIds({
    classNames: [input.className],
    elementIdsByClassName: input.renderIndexes.elementIdsByClassName,
    renderIndexes: input.renderIndexes,
  });
  const matches: CachedClassMatch[] = [];
  for (const elementId of elementIds) {
    const match = matchElementClassRequirement({
      indexes: input.renderIndexes,
      elementId,
      classNames: [input.className],
    });
    if (match.certainty === "impossible") {
      continue;
    }
    matches.push({
      elementId,
      supportingEmissionSiteIds: match.supportingEmissionSiteIds,
      matchedClassNames: match.matchedClassNames,
      certainty: match.certainty,
      confidence: match.certainty === "definite" ? "high" : "medium",
    });
  }
  input.context.classMatchCache.set(input.className, matches);
  return matches;
}

function getConstraintJoinMap(input: {
  constraint: StructuralConstraint;
  leftMatches: SelectorElementMatch[];
  rightMatches: SelectorElementMatch[];
  renderModel: RenderModel;
  structuralRelationIndexes: StructuralRelationIndexes;
  context: StructuralMatchContext;
}): Map<string, string[]> {
  const cacheKey = `${input.constraint.combinator}|${input.constraint.leftClassName}|${input.constraint.rightClassName}`;
  const cached = input.context.constraintJoinCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const leftIds = input.leftMatches.map((match) => match.elementId).sort(compareStrings);
  const rightIds = input.rightMatches.map((match) => match.elementId);
  const leftIdSet = new Set(leftIds);
  const leftBits = buildElementBitset(leftIds, input.structuralRelationIndexes.elementBitsetIndex);

  const relationByRightElementId = new Map<string, string[]>();
  for (const rightElementId of rightIds) {
    relationByRightElementId.set(
      rightElementId,
      getRelatedLeftElementIds({
        renderModel: input.renderModel,
        rightElementId,
        combinator: input.constraint.combinator,
        structuralRelationIndexes: input.structuralRelationIndexes,
        leftIdSet,
        leftBits,
      }),
    );
  }

  input.context.constraintJoinCache.set(cacheKey, relationByRightElementId);
  return relationByRightElementId;
}

function getRelatedLeftElementIds(input: {
  renderModel: RenderModel;
  rightElementId: string;
  combinator: StructuralConstraint["combinator"];
  structuralRelationIndexes: StructuralRelationIndexes;
  leftIdSet: Set<string>;
  leftBits: Uint32Array;
}): string[] {
  if (input.combinator === "child") {
    const element = input.renderModel.indexes.elementById.get(input.rightElementId);
    return element?.parentElementId && input.leftIdSet.has(element.parentElementId)
      ? [element.parentElementId]
      : [];
  }

  if (input.combinator === "adjacent-sibling") {
    const adjacentLeftSiblingId =
      input.structuralRelationIndexes.adjacentLeftSiblingIdByElementId.get(input.rightElementId);
    return adjacentLeftSiblingId && input.leftIdSet.has(adjacentLeftSiblingId)
      ? [adjacentLeftSiblingId]
      : [];
  }

  const relationIds =
    input.combinator === "descendant"
      ? (input.renderModel.indexes.ancestorElementIdsByElementId.get(input.rightElementId) ?? [])
      : (input.structuralRelationIndexes.precedingSiblingIdsByElementId.get(input.rightElementId) ??
        []);

  if (relationIds.length <= 48) {
    return relationIds.filter((elementId) => input.leftIdSet.has(elementId));
  }

  const relationBits =
    input.combinator === "descendant"
      ? input.structuralRelationIndexes.ancestorBitsByElementId.get(input.rightElementId)
      : input.structuralRelationIndexes.precedingSiblingBitsByElementId.get(input.rightElementId);
  return collectIntersectingElementIds(
    relationBits,
    input.leftBits,
    input.structuralRelationIndexes.elementBitsetIndex,
  );
}

function buildChildIndexByElementId(renderModel: RenderModel): Map<string, number> {
  const childIndexByElementId = new Map<string, number>();
  for (const element of renderModel.elements) {
    const path = renderModel.indexes.renderPathById.get(element.renderPathId);
    if (!path) {
      continue;
    }
    if (element.parentElementId) {
      const parentSegmentIndex = path.segments.findIndex(
        (segment) => segment.kind === "element" && segment.elementId === element.parentElementId,
      );
      if (parentSegmentIndex >= 0) {
        const relativeChildIndex = path.segments
          .slice(parentSegmentIndex + 1)
          .find((segment) => segment.kind === "child-index");
        if (relativeChildIndex?.kind === "child-index") {
          childIndexByElementId.set(element.id, relativeChildIndex.index);
          continue;
        }
      }
    }

    for (let i = path.segments.length - 1; i >= 0; i -= 1) {
      const segment = path.segments[i];
      if (segment.kind === "child-index") {
        childIndexByElementId.set(element.id, segment.index);
        break;
      }
      if (segment.kind === "element") {
        continue;
      }
    }
  }
  return childIndexByElementId;
}

function buildRepeatedSiblingCandidateByElementId(renderModel: RenderModel): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const conditionById = new Map(
    renderModel.placementConditions.map((condition) => [condition.id, condition] as const),
  );

  for (const element of renderModel.elements) {
    const repeatedCondition = element.placementConditionIds
      .map((conditionId) => conditionById.get(conditionId))
      .find((condition) => condition?.kind === "repeated-region");
    if (
      repeatedCondition?.kind === "repeated-region" &&
      repeatedCondition.mayHaveMultipleIterations !== false
    ) {
      result.set(element.id, true);
    }
  }

  return result;
}

export function buildStructuralRelationIndexes(
  renderModel: RenderModel,
): StructuralRelationIndexes {
  const childIndexByElementId = buildChildIndexByElementId(renderModel);
  const adjacentLeftSiblingIdByElementId = new Map<string, string>();
  const precedingSiblingIdsByElementId = new Map<string, string[]>();
  const repeatedSiblingCandidateByElementId = buildRepeatedSiblingCandidateByElementId(renderModel);

  const elementIdByIndex = renderModel.elements.map((element) => element.id);
  const indexByElementId = new Map<string, number>(
    elementIdByIndex.map((elementId, index) => [elementId, index]),
  );
  const wordCount = Math.ceil(elementIdByIndex.length / 32);
  const elementBitsetIndex = { indexByElementId, elementIdByIndex, wordCount };
  const ancestorBitsByElementId = new Map<string, Uint32Array>();
  const precedingSiblingBitsByElementId = new Map<string, Uint32Array>();

  for (const [elementId, siblingIds] of renderModel.indexes.siblingElementIdsByElementId) {
    const elementChildIndex = childIndexByElementId.get(elementId);
    if (elementChildIndex === undefined || siblingIds.length === 0) {
      continue;
    }
    const precedingSiblings: Array<{ siblingId: string; childIndex: number }> = [];
    for (const siblingId of siblingIds) {
      const siblingChildIndex = childIndexByElementId.get(siblingId);
      if (siblingChildIndex === undefined || siblingChildIndex >= elementChildIndex) {
        continue;
      }
      precedingSiblings.push({ siblingId, childIndex: siblingChildIndex });
    }
    if (precedingSiblings.length === 0) {
      continue;
    }
    precedingSiblings.sort((left, right) => left.childIndex - right.childIndex);
    const precedingSiblingIds = precedingSiblings.map((entry) => entry.siblingId);
    precedingSiblingIdsByElementId.set(elementId, precedingSiblingIds);
    precedingSiblingBitsByElementId.set(
      elementId,
      buildElementBitset(precedingSiblingIds, elementBitsetIndex),
    );
    const adjacent = precedingSiblings[precedingSiblings.length - 1];
    if (adjacent.childIndex === elementChildIndex - 1) {
      adjacentLeftSiblingIdByElementId.set(elementId, adjacent.siblingId);
    }
  }

  for (const [elementId, ancestorElementIds] of renderModel.indexes.ancestorElementIdsByElementId) {
    ancestorBitsByElementId.set(
      elementId,
      buildElementBitset(ancestorElementIds, elementBitsetIndex),
    );
  }

  return {
    childIndexByElementId,
    adjacentLeftSiblingIdByElementId,
    precedingSiblingIdsByElementId,
    repeatedSiblingCandidateByElementId,
    elementBitsetIndex,
    ancestorBitsByElementId,
    precedingSiblingBitsByElementId,
  };
}

function combineCertainty(
  left: SelectorElementMatch["certainty"],
  right: SelectorElementMatch["certainty"],
): SelectorBranchMatch["certainty"] {
  if (left === "unknown-context" || right === "unknown-context") {
    return "unknown-context";
  }
  if (left === "definite" && right === "definite") {
    return "definite";
  }
  return "possible";
}

function deduplicateElementMatches(matches: SelectorElementMatch[]): SelectorElementMatch[] {
  const byId = new Map<string, SelectorElementMatch>();
  for (const match of matches) {
    byId.set(match.id, match);
  }
  return [...byId.values()].sort((left, right) => compareStrings(left.id, right.id));
}

function mergeUniqueSortedStrings(left: string[], right: string[]): string[] {
  const merged: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    const comparison = compareStrings(leftValue, rightValue);
    if (comparison === 0) {
      merged.push(leftValue);
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    if (comparison < 0) {
      merged.push(leftValue);
      leftIndex += 1;
      continue;
    }
    merged.push(rightValue);
    rightIndex += 1;
  }
  while (leftIndex < left.length) {
    merged.push(left[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex]);
    rightIndex += 1;
  }
  return merged;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function buildElementBitset(
  elementIds: readonly string[],
  bitsetIndex: StructuralRelationIndexes["elementBitsetIndex"],
): Uint32Array {
  const bits = new Uint32Array(bitsetIndex.wordCount);
  for (const elementId of elementIds) {
    const index = bitsetIndex.indexByElementId.get(elementId);
    if (index === undefined) {
      continue;
    }
    bits[index >>> 5] |= 1 << (index & 31);
  }
  return bits;
}

function collectIntersectingElementIds(
  relationBits: Uint32Array | undefined,
  leftBits: Uint32Array,
  bitsetIndex: StructuralRelationIndexes["elementBitsetIndex"],
): string[] {
  if (!relationBits) {
    return [];
  }
  const result: string[] = [];
  for (let wordIndex = 0; wordIndex < relationBits.length; wordIndex += 1) {
    let word = relationBits[wordIndex] & leftBits[wordIndex];
    while (word !== 0) {
      const leastSignificant = word & -word;
      const bitIndex = 31 - Math.clz32(leastSignificant);
      const elementIndex = (wordIndex << 5) + bitIndex;
      const elementId = bitsetIndex.elementIdByIndex[elementIndex];
      if (elementId) {
        result.push(elementId);
      }
      word &= word - 1;
    }
  }
  return result;
}
