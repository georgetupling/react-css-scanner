import type { AnalysisConfidence } from "../../types/analysis.js";
import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderStructureResult } from "../render-structure/index.js";
import { parseSelectorBranch } from "../../libraries/selector-parsing/index.js";
import type {
  ParsedSelectorBranch,
  SelectorStepCombinator,
} from "../../libraries/selector-parsing/index.js";
import { matchElementClassRequirement } from "./elementRequirementMatcher.js";
import {
  selectorBranchMatchId,
  selectorElementMatchId,
  selectorReachabilityDiagnosticId,
} from "./ids.js";
import { buildSelectorRenderMatchIndexes } from "./renderMatchIndexes.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorElementMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityIndexes,
  SelectorReachabilityResult,
  SelectorReachabilityStatus,
} from "./types.js";

export function buildSelectorReachability(
  input: RenderStructureResult,
): SelectorReachabilityResult {
  const renderIndexes = buildSelectorRenderMatchIndexes(input.renderModel);
  const selectorBranches: SelectorBranchReachability[] = [];
  const elementMatches: SelectorElementMatch[] = [];
  const branchMatches: SelectorBranchMatch[] = [];
  const diagnostics: SelectorReachabilityDiagnostic[] = [];

  for (const branch of [...input.graph.nodes.selectorBranches].sort(compareSelectorBranches)) {
    const branchDiagnostics = buildDiagnostics(branch);
    diagnostics.push(...branchDiagnostics);

    const branchElementMatches: SelectorElementMatch[] = [];
    const parsedBranch = parseSelectorBranch(branch.selectorText);
    const structuralConstraint = parsedBranch
      ? projectStructuralConstraint(parsedBranch)
      : undefined;
    if (branch.subjectClassNames.length > 0 && branchDiagnostics.length === 0) {
      branchElementMatches.push(
        ...buildElementMatchesForClassNames({
          branch,
          classNames: branch.subjectClassNames,
          elementIds: getCandidateElementIds({
            classNames: branch.subjectClassNames,
            elementIdsByClassName: renderIndexes.elementIdsByClassName,
            renderIndexes,
          }),
          renderIndexes,
        }),
      );
    }

    const structuralMatches = structuralConstraint
      ? buildStructuralMatches({
          branch,
          constraint: structuralConstraint,
          renderStructure: input,
          renderIndexes,
        })
      : undefined;
    if (structuralMatches) {
      branchElementMatches.push(...structuralMatches.elementMatches);
    }
    const candidateBranchMatches =
      structuralMatches?.branchMatches ??
      buildSubjectBranchMatches({
        branch,
        renderStructure: input,
        elementMatches: branchElementMatches,
      });

    for (const elementMatch of branchElementMatches) {
      elementMatches.push(elementMatch);
    }
    branchMatches.push(...candidateBranchMatches);

    const matchIds = branchMatches
      .filter((match) => match.selectorBranchNodeId === branch.id)
      .map((match) => match.id)
      .sort((left, right) => left.localeCompare(right));
    selectorBranches.push({
      selectorBranchNodeId: branch.id,
      selectorNodeId: branch.selectorNodeId,
      ...(branch.ruleDefinitionNodeId ? { ruleDefinitionNodeId: branch.ruleDefinitionNodeId } : {}),
      ...(branch.stylesheetNodeId ? { stylesheetNodeId: branch.stylesheetNodeId } : {}),
      branchText: branch.selectorText,
      selectorListText: branch.selectorListText,
      branchIndex: branch.branchIndex,
      branchCount: branch.branchCount,
      ruleKey: branch.ruleKey,
      subject: {
        requiredClassNames: uniqueSorted(branch.subjectClassNames),
        unsupportedParts: branchDiagnostics.map((diagnostic) => ({
          reason: diagnostic.message,
          ...(diagnostic.location ? { location: diagnostic.location } : {}),
        })),
      },
      status: getBranchStatus(branchDiagnostics, candidateBranchMatches),
      confidence: getBranchConfidence(branchDiagnostics, candidateBranchMatches),
      matchIds,
      diagnosticIds: branchDiagnostics.map((diagnostic) => diagnostic.id),
      ...(branch.location ? { location: branch.location } : {}),
      traces: [],
    });
  }

  const indexes = buildIndexes({
    selectorBranches,
    elementMatches,
    branchMatches,
    diagnostics,
  });

  return {
    meta: {
      generatedAtStage: "selector-reachability",
      selectorBranchCount: selectorBranches.length,
      elementMatchCount: elementMatches.length,
      branchMatchCount: branchMatches.length,
      diagnosticCount: diagnostics.length,
    },
    selectorBranches,
    elementMatches,
    branchMatches,
    diagnostics,
    indexes,
  };
}

function buildDiagnostics(branch: SelectorBranchNode): SelectorReachabilityDiagnostic[] {
  if (!branch.hasUnknownSemantics) {
    return [];
  }

  return [
    {
      id: selectorReachabilityDiagnosticId({
        selectorBranchNodeId: branch.id,
        code: "unsupported-selector-branch",
      }),
      selectorBranchNodeId: branch.id,
      severity: "debug",
      code: "unsupported-selector-branch",
      message: "selector branch contains unsupported selector semantics",
      ...(branch.location ? { location: branch.location } : {}),
      traces: [],
    },
  ];
}

type StructuralConstraint = {
  combinator: Exclude<SelectorStepCombinator, null>;
  leftClassName: string;
  rightClassName: string;
};

function projectStructuralConstraint(
  parsedBranch: ParsedSelectorBranch,
): StructuralConstraint | undefined {
  if (parsedBranch.steps.length !== 2) {
    return undefined;
  }

  const [leftStep, rightStep] = parsedBranch.steps;
  const combinator = rightStep.combinatorFromPrevious;
  if (
    combinator !== "descendant" &&
    combinator !== "child" &&
    combinator !== "adjacent-sibling" &&
    combinator !== "general-sibling"
  ) {
    return undefined;
  }

  if (
    leftStep.selector.requiredClasses.length !== 1 ||
    rightStep.selector.requiredClasses.length !== 1
  ) {
    return undefined;
  }

  return {
    combinator,
    leftClassName: leftStep.selector.requiredClasses[0],
    rightClassName: rightStep.selector.requiredClasses[0],
  };
}

function buildElementMatchesForClassNames(input: {
  branch: SelectorBranchNode;
  classNames: string[];
  elementIds: string[];
  renderIndexes: ReturnType<typeof buildSelectorRenderMatchIndexes>;
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

function buildSubjectBranchMatches(input: {
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

function buildStructuralMatches(input: {
  branch: SelectorBranchNode;
  constraint: StructuralConstraint;
  renderStructure: RenderStructureResult;
  renderIndexes: ReturnType<typeof buildSelectorRenderMatchIndexes>;
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

function getCandidateElementIds(input: {
  classNames: string[];
  elementIdsByClassName: Map<string, string[]>;
  renderIndexes: ReturnType<typeof buildSelectorRenderMatchIndexes>;
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

function getUnknownClassElementIds(
  renderIndexes: ReturnType<typeof buildSelectorRenderMatchIndexes>,
): string[] {
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

function getBranchStatus(
  diagnostics: SelectorReachabilityDiagnostic[],
  matches: SelectorBranchMatch[],
): SelectorReachabilityStatus {
  if (diagnostics.length > 0) {
    return "unsupported";
  }

  if (matches.some((match) => match.certainty === "definite")) {
    return "definitely-matchable";
  }

  if (matches.some((match) => match.certainty === "possible")) {
    return "possibly-matchable";
  }

  if (matches.some((match) => match.certainty === "unknown-context")) {
    return "only-matches-in-unknown-context";
  }

  return "not-matchable";
}

function getBranchConfidence(
  diagnostics: SelectorReachabilityDiagnostic[],
  matches: SelectorBranchMatch[],
): AnalysisConfidence {
  if (diagnostics.length > 0) {
    return "low";
  }

  if (matches.some((match) => match.certainty === "definite")) {
    return "high";
  }

  if (matches.length > 0) {
    return "medium";
  }

  return "high";
}

function buildIndexes(input: {
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

function selectorBranchSourceKeyFromReachability(branch: SelectorBranchReachability): string {
  return [
    branch.ruleKey,
    branch.branchIndex,
    branch.branchText,
    branch.location ? anchorKey(branch.location) : "",
  ].join(":");
}

function compareSelectorBranches(left: SelectorBranchNode, right: SelectorBranchNode): number {
  return (
    (left.location?.filePath ?? "").localeCompare(right.location?.filePath ?? "") ||
    (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0) ||
    (left.location?.startColumn ?? 0) - (right.location?.startColumn ?? 0) ||
    left.ruleKey.localeCompare(right.ruleKey) ||
    left.branchIndex - right.branchIndex ||
    left.id.localeCompare(right.id)
  );
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function anchorKey(anchor: {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
}): string {
  return [
    anchor.filePath.replace(/\\/g, "/"),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}
