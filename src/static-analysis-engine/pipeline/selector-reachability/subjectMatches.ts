import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderStructureResult } from "../render-structure/index.js";
import { matchElementClassRequirement } from "./elementRequirementMatcher.js";
import { selectorBranchMatchId, selectorElementMatchId } from "./ids.js";
import { buildSelectorRenderMatchIndexes } from "./renderMatchIndexes.js";
import type { SelectorBranchMatch, SelectorElementMatch } from "./types.js";
import { uniqueSorted } from "./utils.js";

export type SelectorRenderMatchIndexes = ReturnType<typeof buildSelectorRenderMatchIndexes>;

export function buildElementMatchesForClassNames(input: {
  branch: SelectorBranchNode;
  classNames: string[];
  elementIds: string[];
  renderIndexes: SelectorRenderMatchIndexes;
}): SelectorElementMatch[] {
  const matches: SelectorElementMatch[] = [];
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
        requiredClassNames: uniqueSorted(input.classNames),
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
  renderStructure: RenderStructureResult;
  elementMatches: SelectorElementMatch[];
}): SelectorBranchMatch[] {
  return input.elementMatches.flatMap((elementMatch) => {
    const element = input.renderStructure.renderModel.indexes.elementById.get(
      elementMatch.elementId,
    );
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
  const unknownElementIds = getUnknownClassElementIds(input.renderIndexes);
  let candidates = new Set([
    ...(input.elementIdsByClassName.get(firstClassName) ?? []),
    ...unknownElementIds,
  ]);
  for (const className of restClassNames) {
    const elementIds = new Set([
      ...(input.elementIdsByClassName.get(className) ?? []),
      ...unknownElementIds,
    ]);
    candidates = new Set([...candidates].filter((elementId) => elementIds.has(elementId)));
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function getUnknownClassElementIds(renderIndexes: SelectorRenderMatchIndexes): string[] {
  const elementIds = new Set<string>();
  for (const site of renderIndexes.renderModel.emissionSites) {
    if (!site.elementId) {
      continue;
    }
    if (site.confidence === "low" || site.unsupported.length > 0) {
      elementIds.add(site.elementId);
    }
  }
  return [...elementIds].sort((left, right) => left.localeCompare(right));
}
