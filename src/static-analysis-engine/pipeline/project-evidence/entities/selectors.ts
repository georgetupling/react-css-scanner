import type { ProjectSelectorProjectionResult } from "../../selector-reachability/index.js";
import type {
  ProjectEvidenceBuilderIndexes,
  SelectorBranchAnalysis,
  SelectorQueryAnalysis,
} from "../analysisTypes.js";
import {
  compareById,
  createSelectorBranchId,
  createSelectorQueryId,
  normalizeProjectPath,
  pushMapValue,
  sortIndexValues,
} from "../internal/shared.js";

export function buildSelectorQueries(input: {
  projectSelectorProjection: ProjectSelectorProjectionResult | undefined;
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
  stylesheetIdByFactGraphNodeId: Map<string, string>;
}): SelectorQueryAnalysis[] {
  const projection = input.projectSelectorProjection;
  if (!projection) {
    return [];
  }
  const branchProjectionsBySelectorNodeId = new Map<string, typeof projection.selectorBranches>();
  for (const branch of projection.selectorBranches) {
    const branches = branchProjectionsBySelectorNodeId.get(branch.selectorNodeId) ?? [];
    branches.push(branch);
    branchProjectionsBySelectorNodeId.set(branch.selectorNodeId, branches);
  }

  const selectorQueries = projection.selectorQueries.map((queryProjection, index) => {
    const stylesheetId = resolveStylesheetId({
      stylesheetNodeId: queryProjection.stylesheetNodeId,
      locationFilePath: queryProjection.location?.filePath,
      stylesheetIdByFactGraphNodeId: input.stylesheetIdByFactGraphNodeId,
      indexes: input.indexes,
    });

    const selectorBranches =
      branchProjectionsBySelectorNodeId.get(queryProjection.selectorNodeId) ?? [];
    const scopedCandidates = selectorBranches
      .map((branch) => branch.scopedReachability)
      .filter(
        (
          candidate,
        ): candidate is NonNullable<(typeof selectorBranches)[number]["scopedReachability"]> =>
          Boolean(candidate),
      );

    const query: SelectorQueryAnalysis = {
      id: createSelectorQueryId({
        location: queryProjection.location,
        selectorNodeId: queryProjection.selectorNodeId,
        index,
        selectorText: queryProjection.selectorText,
      }),
      stylesheetId,
      selectorText: queryProjection.selectorText,
      location: queryProjection.location,
      selectorNodeId: queryProjection.selectorNodeId,
      ruleDefinitionNodeId: queryProjection.ruleDefinitionNodeId,
      stylesheetNodeId: queryProjection.stylesheetNodeId,
      selectorReachabilityStatus: queryProjection.selectorReachabilityStatuses.includes(
        "definitely-matchable",
      )
        ? "definitely-matchable"
        : (queryProjection.selectorReachabilityStatuses[0] ?? "unsupported"),
      selectorReachabilityStatuses: [...queryProjection.selectorReachabilityStatuses],
      reasons: [...queryProjection.reasons],
      scopedReachability:
        scopedCandidates.length > 0
          ? {
              availability: scopedCandidates.some(
                (candidate) => candidate.availability === "definite",
              )
                ? "definite"
                : scopedCandidates[0].availability,
              contextCount: Math.max(
                ...scopedCandidates.map((candidate) => candidate.contexts.length),
              ),
              matchedContextCount: Math.max(
                ...scopedCandidates.map((candidate) => candidate.matchedContexts.length),
              ),
              reasons: [
                ...new Set(scopedCandidates.flatMap((candidate) => candidate.reasons)),
              ].sort((left, right) => left.localeCompare(right)),
            }
          : undefined,
      confidence: queryProjection.confidence,
      traces: input.includeTraces ? [...queryProjection.traces] : [],
    };

    if (stylesheetId) {
      pushMapValue(input.indexes.selectorQueriesByStylesheetId, stylesheetId, query.id);
    }

    return query;
  });

  sortIndexValues(input.indexes.selectorQueriesByStylesheetId);
  return selectorQueries.sort(compareById);
}

export function buildSelectorBranches(input: {
  projectSelectorProjection: ProjectSelectorProjectionResult | undefined;
  selectorQueries: SelectorQueryAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): SelectorBranchAnalysis[] {
  const projection = input.projectSelectorProjection;
  if (!projection) {
    return [];
  }

  const queryBySelectorNodeId = new Map(
    input.selectorQueries
      .filter((query) => query.selectorNodeId)
      .map((query) => [query.selectorNodeId as string, query]),
  );

  const selectorBranches: SelectorBranchAnalysis[] = [];
  for (const [index, branchProjection] of projection.selectorBranches.entries()) {
    const sourceQuery = queryBySelectorNodeId.get(branchProjection.selectorNodeId);
    if (!sourceQuery) {
      continue;
    }

    selectorBranches.push({
      id: createSelectorBranchId(
        {
          location: branchProjection.location,
          branchIndex: branchProjection.branchIndex,
          selectorBranchNodeId: branchProjection.selectorBranchNodeId,
          selectorQueryId: sourceQuery.id,
        },
        index,
      ),
      selectorQueryId: sourceQuery.id,
      selectorBranchNodeId: branchProjection.selectorBranchNodeId,
      selectorNodeId: branchProjection.selectorNodeId,
      ruleDefinitionNodeId: branchProjection.ruleDefinitionNodeId,
      stylesheetNodeId: branchProjection.stylesheetNodeId,
      stylesheetId: sourceQuery.stylesheetId,
      selectorText: branchProjection.selectorText,
      selectorListText: branchProjection.selectorListText,
      branchIndex: branchProjection.branchIndex,
      branchCount: branchProjection.branchCount,
      ruleKey: branchProjection.ruleKey,
      location: branchProjection.location,
      selectorReachabilityStatus: branchProjection.selectorReachabilityStatus,
      reasons: [...branchProjection.reasons],
      scopedReachability: branchProjection.scopedReachability
        ? {
            availability: branchProjection.scopedReachability.availability,
            contextCount: branchProjection.scopedReachability.contexts.length,
            matchedContextCount: branchProjection.scopedReachability.matchedContexts.length,
            reasons: [...branchProjection.scopedReachability.reasons],
          }
        : undefined,
      confidence: branchProjection.confidence,
      traces: input.includeTraces ? [...branchProjection.traces] : [],
      sourceQuery,
    });
  }

  return selectorBranches.sort(compareById);
}

function resolveStylesheetId(input: {
  stylesheetNodeId?: string;
  locationFilePath?: string;
  stylesheetIdByFactGraphNodeId: Map<string, string>;
  indexes: ProjectEvidenceBuilderIndexes;
}): string | undefined {
  if (input.stylesheetNodeId) {
    const byNodeId = input.stylesheetIdByFactGraphNodeId.get(input.stylesheetNodeId);
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (input.locationFilePath) {
    return input.indexes.stylesheetIdByPath.get(normalizeProjectPath(input.locationFilePath));
  }

  return undefined;
}
