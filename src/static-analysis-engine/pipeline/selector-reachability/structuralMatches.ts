import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderStructureResult } from "../render-structure/index.js";
import { selectorBranchMatchId } from "./ids.js";
import {
  buildElementMatchesForClassNames,
  getCandidateElementIds,
  type SelectorRenderMatchIndexes,
} from "./subjectMatches.js";
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
  renderStructure: RenderStructureResult;
  renderIndexes: SelectorRenderMatchIndexes;
}): { elementMatches: SelectorElementMatch[]; branchMatches: SelectorBranchMatch[] } {
  const leftMatches = buildElementMatchesForClassNames({
    branch: input.branch,
    classNames: [input.constraint.leftClassName],
    elementIds: getCandidateElementIds({
      classNames: [input.constraint.leftClassName],
      elementIdsByClassName: input.renderIndexes.elementIdsByClassName,
      renderIndexes: input.renderIndexes,
    }),
    renderIndexes: input.renderIndexes,
  });
  const rightMatches = buildElementMatchesForClassNames({
    branch: input.branch,
    classNames: [input.constraint.rightClassName],
    elementIds: getCandidateElementIds({
      classNames: [input.constraint.rightClassName],
      elementIdsByClassName: input.renderIndexes.elementIdsByClassName,
      renderIndexes: input.renderIndexes,
    }),
    renderIndexes: input.renderIndexes,
  });
  const leftMatchByElementId = new Map(leftMatches.map((match) => [match.elementId, match]));
  const branchMatches: SelectorBranchMatch[] = [];

  for (const rightMatch of rightMatches) {
    for (const leftElementId of getRelatedLeftElementIds({
      renderStructure: input.renderStructure,
      rightElementId: rightMatch.elementId,
      combinator: input.constraint.combinator,
    })) {
      const leftMatch = leftMatchByElementId.get(leftElementId);
      if (!leftMatch) {
        continue;
      }

      const rightElement = input.renderStructure.renderModel.indexes.elementById.get(
        rightMatch.elementId,
      );
      const leftElement = input.renderStructure.renderModel.indexes.elementById.get(leftElementId);
      if (!rightElement || !leftElement) {
        continue;
      }

      const certainty = combineCertainty(leftMatch.certainty, rightMatch.certainty);
      branchMatches.push({
        id: selectorBranchMatchId({
          selectorBranchNodeId: input.branch.id,
          elementId: `${leftMatch.elementId}:${rightMatch.elementId}`,
        }),
        selectorBranchNodeId: input.branch.id,
        subjectElementId: rightMatch.elementId,
        elementMatchIds: [leftMatch.id, rightMatch.id].sort((left, right) =>
          left.localeCompare(right),
        ),
        supportingEmissionSiteIds: uniqueSorted([
          ...leftMatch.supportingEmissionSiteIds,
          ...rightMatch.supportingEmissionSiteIds,
        ]),
        requiredClassNames: uniqueSorted([
          input.constraint.leftClassName,
          input.constraint.rightClassName,
        ]),
        matchedClassNames: uniqueSorted([
          ...leftMatch.matchedClassNames,
          ...rightMatch.matchedClassNames,
        ]),
        renderPathIds: uniqueSorted([leftElement.renderPathId, rightElement.renderPathId]),
        placementConditionIds: uniqueSorted([
          ...leftElement.placementConditionIds,
          ...rightElement.placementConditionIds,
        ]),
        certainty,
        confidence: certainty === "definite" ? "high" : "medium",
        traces: [],
      });
    }
  }

  return {
    elementMatches: deduplicateElementMatches([...leftMatches, ...rightMatches]),
    branchMatches: branchMatches.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function getRelatedLeftElementIds(input: {
  renderStructure: RenderStructureResult;
  rightElementId: string;
  combinator: StructuralConstraint["combinator"];
}): string[] {
  if (input.combinator === "descendant") {
    return (
      input.renderStructure.renderModel.indexes.ancestorElementIdsByElementId.get(
        input.rightElementId,
      ) ?? []
    );
  }

  if (input.combinator === "child") {
    const element = input.renderStructure.renderModel.indexes.elementById.get(input.rightElementId);
    return element?.parentElementId ? [element.parentElementId] : [];
  }

  const siblingIds =
    input.renderStructure.renderModel.indexes.siblingElementIdsByElementId.get(
      input.rightElementId,
    ) ?? [];
  return siblingIds.filter((leftElementId) =>
    isOrderedSiblingMatch({
      renderStructure: input.renderStructure,
      leftElementId,
      rightElementId: input.rightElementId,
      relation: input.combinator === "adjacent-sibling" ? "adjacent" : "general",
    }),
  );
}

function isOrderedSiblingMatch(input: {
  renderStructure: RenderStructureResult;
  leftElementId: string;
  rightElementId: string;
  relation: "adjacent" | "general";
}): boolean {
  const leftIndex = readChildIndex(input.renderStructure, input.leftElementId);
  const rightIndex = readChildIndex(input.renderStructure, input.rightElementId);
  if (leftIndex === undefined || rightIndex === undefined) {
    return false;
  }
  return input.relation === "adjacent" ? rightIndex === leftIndex + 1 : rightIndex > leftIndex;
}

function readChildIndex(
  renderStructure: RenderStructureResult,
  elementId: string,
): number | undefined {
  const element = renderStructure.renderModel.indexes.elementById.get(elementId);
  if (!element) {
    return undefined;
  }
  const path = renderStructure.renderModel.indexes.renderPathById.get(element.renderPathId);
  if (!path) {
    return undefined;
  }

  for (let i = path.segments.length - 1; i >= 0; i -= 1) {
    const segment = path.segments[i];
    if (segment.kind === "child-index") {
      return segment.index;
    }
    if (segment.kind === "element") {
      continue;
    }
  }
  return undefined;
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
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
