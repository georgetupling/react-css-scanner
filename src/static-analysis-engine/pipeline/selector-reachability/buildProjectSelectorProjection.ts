import type { FactGraphResult, SelectorBranchNode } from "../fact-graph/index.js";
import type {
  ReachabilitySummary,
  StylesheetReachabilityContextRecord,
} from "../reachability/index.js";
import type { RenderModel, RenderPathSegment } from "../render-structure/index.js";
import { selectorBranchSourceKey } from "./ids.js";
import { compareSelectorBranches } from "./indexes.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorReachabilityResult,
} from "./types.js";
import type {
  ProjectSelectorBranchProjection,
  ProjectSelectorProjectionResult,
  ProjectSelectorQueryProjection,
  ProjectSelectorScopedReachability,
} from "./projectProjectionTypes.js";

type AvailableContextRecord = StylesheetReachabilityContextRecord & {
  availability: "definite" | "possible";
};

type RenderRegionContext = Extract<
  StylesheetReachabilityContextRecord["context"],
  { kind: "render-region" }
>;

type ProjectedRenderPathSegment = RenderRegionContext["path"][number];

type SelectorProjectionTarget = {
  elementIds: string[];
  contexts: AvailableContextRecord[];
};

type SelectorRenderModelIndex = {
  renderModel: RenderModel;
  componentKeyByNodeId: Map<string, string>;
};

export function buildProjectSelectorProjection(input: {
  factGraph: FactGraphResult;
  selectorReachability: SelectorReachabilityResult;
  renderModel: RenderModel;
  reachabilitySummary?: ReachabilitySummary;
  includeTraces?: boolean;
}): ProjectSelectorProjectionResult {
  const includeTraces = input.includeTraces ?? true;
  const renderModelIndex = buildSelectorRenderModelIndex(input.renderModel);
  const reachableTargetsByStylesheetPath = new Map<string, SelectorProjectionTarget>();
  const branchProjectionBySelectorBranchNodeId = new Map<string, ProjectSelectorBranchProjection>();
  const branchProjectionBySourceKey = new Map<string, ProjectSelectorBranchProjection>();
  const queryProjectionBySelectorNodeId = new Map<string, ProjectSelectorQueryProjection>();
  const branchProjectionIdsByStylesheetNodeId = new Map<string, string[]>();
  const selectorBranches = [...input.factGraph.graph.nodes.selectorBranches].sort(
    compareSelectorBranches,
  );
  const branchProjections: ProjectSelectorBranchProjection[] = [];

  for (const selectorBranch of selectorBranches) {
    const reachabilityBranch =
      input.selectorReachability.indexes.branchReachabilityBySelectorBranchNodeId.get(
        selectorBranch.id,
      );
    if (!reachabilityBranch) {
      continue;
    }

    const scopedReachability = buildScopedReachability({
      branch: reachabilityBranch,
      selectorBranch,
      selectorReachability: input.selectorReachability,
      reachabilitySummary: input.reachabilitySummary,
      renderModelIndex,
      reachableTargetsByStylesheetPath,
      includeTraces,
    });

    const projection: ProjectSelectorBranchProjection = {
      selectorBranchNodeId: reachabilityBranch.selectorBranchNodeId,
      selectorNodeId: reachabilityBranch.selectorNodeId,
      ...(reachabilityBranch.ruleDefinitionNodeId
        ? { ruleDefinitionNodeId: reachabilityBranch.ruleDefinitionNodeId }
        : {}),
      ...(reachabilityBranch.stylesheetNodeId
        ? { stylesheetNodeId: reachabilityBranch.stylesheetNodeId }
        : {}),
      selectorText: reachabilityBranch.branchText,
      selectorListText: reachabilityBranch.selectorListText,
      branchIndex: reachabilityBranch.branchIndex,
      branchCount: reachabilityBranch.branchCount,
      ruleKey: reachabilityBranch.ruleKey,
      ...(reachabilityBranch.location ? { location: reachabilityBranch.location } : {}),
      constraint: reachabilityBranch.requirement,
      requirement: reachabilityBranch.requirement,
      selectorReachabilityStatus: reachabilityBranch.status,
      confidence: reachabilityBranch.confidence,
      reasons: buildBranchReasons(reachabilityBranch, scopedReachability),
      traces: includeTraces ? reachabilityBranch.traces : [],
      ...(scopedReachability ? { scopedReachability } : {}),
    };

    branchProjections.push(projection);
    branchProjectionBySelectorBranchNodeId.set(projection.selectorBranchNodeId, projection);
    branchProjectionBySourceKey.set(
      selectorBranchSourceKey({
        ruleKey: projection.ruleKey,
        branchIndex: projection.branchIndex,
        selectorText: projection.selectorText,
        location: projection.location,
      }),
      projection,
    );

    if (projection.stylesheetNodeId) {
      const ids = branchProjectionIdsByStylesheetNodeId.get(projection.stylesheetNodeId) ?? [];
      ids.push(projection.selectorBranchNodeId);
      branchProjectionIdsByStylesheetNodeId.set(projection.stylesheetNodeId, ids);
    }
  }

  for (const [stylesheetNodeId, ids] of branchProjectionIdsByStylesheetNodeId.entries()) {
    branchProjectionIdsByStylesheetNodeId.set(
      stylesheetNodeId,
      [...new Set(ids)].sort((left, right) => left.localeCompare(right)),
    );
  }

  const queryProjectionBySelectorId = new Map<string, ProjectSelectorQueryProjection>();
  for (const projection of branchProjections) {
    const existing = queryProjectionBySelectorId.get(projection.selectorNodeId);
    if (!existing) {
      queryProjectionBySelectorId.set(projection.selectorNodeId, {
        selectorNodeId: projection.selectorNodeId,
        ...(projection.stylesheetNodeId ? { stylesheetNodeId: projection.stylesheetNodeId } : {}),
        ...(projection.ruleDefinitionNodeId
          ? { ruleDefinitionNodeId: projection.ruleDefinitionNodeId }
          : {}),
        selectorText: projection.selectorText,
        ...(projection.location ? { location: projection.location } : {}),
        branchIds: [projection.selectorBranchNodeId],
        selectorReachabilityStatuses: [projection.selectorReachabilityStatus],
        confidence: projection.confidence,
        reasons: [...projection.reasons],
        traces: [...projection.traces],
      });
      continue;
    }

    existing.branchIds.push(projection.selectorBranchNodeId);
    existing.selectorReachabilityStatuses.push(projection.selectorReachabilityStatus);
    for (const reason of projection.reasons) {
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
    }
    if (confidenceRank(projection.confidence) < confidenceRank(existing.confidence)) {
      existing.confidence = projection.confidence;
    }
    if (projection.stylesheetNodeId && !existing.stylesheetNodeId) {
      existing.stylesheetNodeId = projection.stylesheetNodeId;
    }
    if (projection.ruleDefinitionNodeId && !existing.ruleDefinitionNodeId) {
      existing.ruleDefinitionNodeId = projection.ruleDefinitionNodeId;
    }
    if (projection.location && !existing.location) {
      existing.location = projection.location;
    }
    if (includeTraces) {
      existing.traces.push(...projection.traces);
    }
  }

  const queryProjections = [...queryProjectionBySelectorId.values()]
    .map((query) => ({
      ...query,
      branchIds: [...new Set(query.branchIds)].sort((left, right) => left.localeCompare(right)),
      selectorReachabilityStatuses: [...query.selectorReachabilityStatuses].sort((left, right) =>
        left.localeCompare(right),
      ),
      traces: includeTraces ? query.traces : [],
    }))
    .sort((left, right) => {
      return (
        (left.location?.filePath ?? "").localeCompare(right.location?.filePath ?? "") ||
        (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0) ||
        (left.location?.startColumn ?? 0) - (right.location?.startColumn ?? 0) ||
        left.selectorText.localeCompare(right.selectorText) ||
        left.selectorNodeId.localeCompare(right.selectorNodeId)
      );
    });

  for (const query of queryProjections) {
    queryProjectionBySelectorNodeId.set(query.selectorNodeId, query);
  }

  return {
    meta: {
      generatedAtStage: "selector-reachability-project-projection",
      selectorBranchCount: branchProjections.length,
      selectorQueryCount: queryProjections.length,
    },
    selectorBranches: branchProjections,
    selectorQueries: queryProjections,
    indexes: {
      branchProjectionBySelectorBranchNodeId,
      branchProjectionBySourceKey,
      queryProjectionBySelectorNodeId,
      branchProjectionIdsByStylesheetNodeId,
    },
  };
}

function buildScopedReachability(input: {
  branch: SelectorBranchReachability;
  selectorBranch: SelectorBranchNode;
  selectorReachability: SelectorReachabilityResult;
  reachabilitySummary?: ReachabilitySummary;
  renderModelIndex: SelectorRenderModelIndex;
  reachableTargetsByStylesheetPath: Map<string, SelectorProjectionTarget>;
  includeTraces: boolean;
}): ProjectSelectorScopedReachability | undefined {
  const cssFilePath = input.selectorBranch.location?.filePath;
  if (!cssFilePath) {
    return undefined;
  }

  const reachabilityRecord = input.reachabilitySummary?.stylesheets.find(
    (stylesheet) =>
      normalizeProjectPath(stylesheet.cssFilePath ?? "") === normalizeProjectPath(cssFilePath),
  );
  if (!reachabilityRecord) {
    return undefined;
  }

  const cacheKey = normalizeProjectPath(reachabilityRecord.cssFilePath ?? cssFilePath);
  let target = input.reachableTargetsByStylesheetPath.get(cacheKey);
  if (!target) {
    const contexts = reachabilityRecord.contexts.filter(isAvailableContextRecord);
    const elementIds = deduplicateElementIds(
      contexts.flatMap((context) => resolveElementIdsForContext(input.renderModelIndex, context)),
    );
    target = { elementIds, contexts };
    input.reachableTargetsByStylesheetPath.set(cacheKey, target);
  }

  const scopedMatches = input.branch.matchIds
    .map((matchId) => input.selectorReachability.indexes.matchById.get(matchId))
    .filter((match): match is SelectorBranchMatch => Boolean(match))
    .filter((match) => target.elementIds.includes(match.subjectElementId));

  const matchedContextMap = new Map<string, AvailableContextRecord>();
  for (const context of target.contexts) {
    const contextElementIds = resolveElementIdsForContext(input.renderModelIndex, context);
    if (
      contextElementIds.some((elementId) =>
        scopedMatches.some((match) => match.subjectElementId === elementId),
      )
    ) {
      matchedContextMap.set(serializeContext(context), context);
    }
  }

  return {
    kind: "css-source",
    cssFilePath: reachabilityRecord.cssFilePath,
    availability: reachabilityRecord.availability,
    contexts: reachabilityRecord.contexts,
    matchedContexts: [...matchedContextMap.values()].sort((left, right) =>
      serializeContext(left).localeCompare(serializeContext(right)),
    ),
    reasons: reachabilityRecord.reasons,
    traces: input.includeTraces ? reachabilityRecord.traces : [],
  };
}

function buildBranchReasons(
  branch: SelectorBranchReachability,
  scopedReachability?: ProjectSelectorScopedReachability,
): string[] {
  if (branch.status === "unsupported") {
    return ["selector branch contains unsupported selector semantics"];
  }
  if (branch.status === "not-matchable") {
    const scopedReason =
      branch.matchIds.length > 0 &&
      scopedReachability &&
      scopedReachability.contexts.length > 0 &&
      scopedReachability.matchedContexts.length === 0
        ? "selector has global matches, but not in stylesheet-reachable contexts"
        : "no bounded selector match was found";
    return [scopedReason];
  }
  if (branch.status === "only-matches-in-unknown-context") {
    return ["selector can only match through unknown render or class context"];
  }
  if (branch.status === "possibly-matchable") {
    return ["a bounded selector match is possible"];
  }
  return ["a bounded selector match was found"];
}

function confidenceRank(confidence: "low" | "medium" | "high"): number {
  if (confidence === "high") {
    return 2;
  }
  if (confidence === "medium") {
    return 1;
  }
  return 0;
}

function buildSelectorRenderModelIndex(renderModel: RenderModel): SelectorRenderModelIndex {
  return {
    renderModel,
    componentKeyByNodeId: new Map(
      renderModel.components
        .filter((component) => component.componentNodeId)
        .map((component) => [component.componentNodeId as string, component.componentKey]),
    ),
  };
}

function isAvailableContextRecord(
  context: StylesheetReachabilityContextRecord,
): context is AvailableContextRecord {
  return context.availability === "definite" || context.availability === "possible";
}

function resolveElementIdsForContext(
  index: SelectorRenderModelIndex,
  contextRecord: AvailableContextRecord,
): string[] {
  const context = contextRecord.context;
  if (context.kind === "source-file") {
    return getElementIdsForSourceFile(index, context.filePath);
  }
  if (context.kind === "component" || context.kind === "render-subtree-root") {
    const componentKey = resolveComponentKey(index, context);
    return componentKey ? getElementIdsForComponentKey(index, componentKey) : [];
  }
  const componentKey = resolveComponentKey(index, context);
  if (!componentKey) {
    return [];
  }
  const regionElementIds = getElementIdsForRenderRegion(index, componentKey, context.path);
  return regionElementIds.length > 0
    ? regionElementIds
    : getElementIdsForComponentKey(index, componentKey);
}

function getElementIdsForSourceFile(index: SelectorRenderModelIndex, filePath: string): string[] {
  const normalizedPath = normalizeProjectPath(filePath);
  const componentKeys = index.renderModel.components
    .filter((component) => normalizeProjectPath(component.filePath) === normalizedPath)
    .map((component) => component.componentKey);
  return deduplicateElementIds(
    componentKeys.flatMap((componentKey) => getElementIdsForComponentKey(index, componentKey)),
  );
}

function getElementIdsForComponentKey(
  index: SelectorRenderModelIndex,
  componentKey: string,
): string[] {
  return deduplicateElementIds(
    index.renderModel.elements
      .filter((element) => elementBelongsToRootComponent(index, element.id, componentKey))
      .map((element) => element.id),
  );
}

function getElementIdsForRenderRegion(
  index: SelectorRenderModelIndex,
  componentKey: string,
  contextPath: RenderRegionContext["path"],
): string[] {
  return deduplicateElementIds(
    index.renderModel.elements
      .filter((element) => {
        if (!elementBelongsToRootComponent(index, element.id, componentKey)) {
          return false;
        }
        const renderPath = index.renderModel.indexes.renderPathById.get(element.renderPathId);
        if (!renderPath) {
          return false;
        }
        return pathStartsWith(projectLegacyPath(renderPath.segments), contextPath);
      })
      .map((element) => element.id),
  );
}

function elementBelongsToRootComponent(
  index: SelectorRenderModelIndex,
  elementId: string,
  componentKey: string,
): boolean {
  const element = index.renderModel.indexes.elementById.get(elementId);
  if (!element) {
    return false;
  }
  const renderPath = index.renderModel.indexes.renderPathById.get(element.renderPathId);
  const rootComponentKey = renderPath?.rootComponentNodeId
    ? index.componentKeyByNodeId.get(renderPath.rootComponentNodeId)
    : undefined;
  if (rootComponentKey) {
    return rootComponentKey === componentKey;
  }
  const placementComponentKey = element.placementComponentNodeId
    ? index.componentKeyByNodeId.get(element.placementComponentNodeId)
    : undefined;
  if (placementComponentKey) {
    return placementComponentKey === componentKey;
  }
  const emittingComponentKey = element.emittingComponentNodeId
    ? index.componentKeyByNodeId.get(element.emittingComponentNodeId)
    : undefined;
  return emittingComponentKey === componentKey;
}

function resolveComponentKey(
  index: SelectorRenderModelIndex,
  context: Extract<
    StylesheetReachabilityContextRecord["context"],
    { kind: "component" | "render-subtree-root" | "render-region" }
  >,
): string | undefined {
  if (context.componentKey) {
    return context.componentKey;
  }
  const normalizedPath = normalizeProjectPath(context.filePath);
  return index.renderModel.components.find(
    (component) =>
      normalizeProjectPath(component.filePath) === normalizedPath &&
      component.componentName === context.componentName,
  )?.componentKey;
}

function projectLegacyPath(segments: RenderPathSegment[]): ProjectedRenderPathSegment[] {
  const result: ProjectedRenderPathSegment[] = [{ kind: "root" }];
  for (const segment of segments) {
    if (segment.kind === "child-index") {
      result.push({ kind: "fragment-child", childIndex: segment.index });
      continue;
    }
    if (segment.kind === "conditional-branch") {
      result.push({ kind: "conditional-branch", branch: segment.branch });
      continue;
    }
    if (segment.kind === "repeated-template") {
      result.push({ kind: "repeated-template" });
    }
  }
  return result;
}

function pathStartsWith(
  candidate: ProjectedRenderPathSegment[],
  prefix: ProjectedRenderPathSegment[],
): boolean {
  if (prefix.length > candidate.length) {
    return false;
  }
  return prefix.every(
    (segment, index) => serializePathSegment(segment) === serializePathSegment(candidate[index]),
  );
}

function serializePathSegment(segment: ProjectedRenderPathSegment): string {
  if (segment.kind === "fragment-child") {
    return `${segment.kind}:${segment.childIndex ?? ""}`;
  }
  if (segment.kind === "conditional-branch") {
    return `${segment.kind}:${segment.branch ?? ""}`;
  }
  return segment.kind;
}

function serializeContext(context: StylesheetReachabilityContextRecord): string {
  return JSON.stringify(context.context);
}

function deduplicateElementIds(elementIds: string[]): string[] {
  return [...new Set(elementIds)].sort((left, right) => left.localeCompare(right));
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
