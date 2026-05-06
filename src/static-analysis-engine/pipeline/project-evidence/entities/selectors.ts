import type {
  ProjectEvidenceBuildInput,
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
  projectInput: ProjectEvidenceBuildInput;
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
  stylesheetIdByFactGraphNodeId: Map<string, string>;
}): SelectorQueryAnalysis[] {
  const selectorReachability = input.projectInput.selectorReachability;
  if (!selectorReachability) {
    return [];
  }
  const selectorQueries = selectorReachability.selectorQueries.map((queryProjection, index) => {
    const stylesheetId = resolveStylesheetId({
      stylesheetNodeId: queryProjection.stylesheetNodeId,
      locationFilePath: queryProjection.location?.filePath,
      stylesheetIdByFactGraphNodeId: input.stylesheetIdByFactGraphNodeId,
      indexes: input.indexes,
    });

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
  projectInput: ProjectEvidenceBuildInput;
  selectorQueries: SelectorQueryAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): SelectorBranchAnalysis[] {
  const selectorReachability = input.projectInput.selectorReachability;
  if (!selectorReachability) {
    return [];
  }

  const queryBySelectorNodeId = new Map(
    input.selectorQueries
      .filter((query) => query.selectorNodeId)
      .map((query) => [query.selectorNodeId as string, query]),
  );

  const selectorBranches: SelectorBranchAnalysis[] = [];
  for (const [index, branchProjection] of selectorReachability.selectorBranches.entries()) {
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
      selectorText: branchProjection.branchText,
      selectorListText: branchProjection.selectorListText,
      branchIndex: branchProjection.branchIndex,
      branchCount: branchProjection.branchCount,
      ruleKey: branchProjection.ruleKey,
      location: branchProjection.location,
      selectorReachabilityStatus: branchProjection.status,
      classAttributePredicates: branchProjection.subject.classAttributePredicates.map(
        (predicate) => ({
          ...predicate,
        }),
      ),
      reasons: [...branchProjection.reasons],
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
