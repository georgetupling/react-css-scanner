import type { SelectorQueryResult } from "../../selector-analysis/types.js";
import type {
  ProjectAnalysisIndexes,
  SelectorBranchAnalysis,
  SelectorQueryAnalysis,
  StylesheetAnalysis,
} from "../../project-analysis/index.js";
import {
  compareById,
  createSelectorBranchId,
  createSelectorQueryId,
  createSelectorRuleKey,
  normalizeProjectPath,
  pushMapValue,
  simplifyConstraint,
  sortIndexValues,
} from "../internal/shared.js";

export function buildSelectorQueries(
  selectorQueryResults: SelectorQueryResult[],
  stylesheets: StylesheetAnalysis[],
  indexes: ProjectAnalysisIndexes,
  includeTraces: boolean,
): SelectorQueryAnalysis[] {
  const stylesheetById = new Map(stylesheets.map((stylesheet) => [stylesheet.id, stylesheet]));

  const selectorQueries = selectorQueryResults.map((selectorQueryResult, index) => {
    const stylesheetId =
      selectorQueryResult.source.kind === "css-source" &&
      selectorQueryResult.reachability?.kind === "css-source"
        ? indexes.stylesheetIdByPath.get(
            normalizeProjectPath(selectorQueryResult.reachability.cssFilePath ?? ""),
          )
        : undefined;

    const query: SelectorQueryAnalysis = {
      id: createSelectorQueryId(selectorQueryResult, index),
      stylesheetId,
      selectorText: selectorQueryResult.selectorText,
      location:
        selectorQueryResult.source.kind === "css-source"
          ? selectorQueryResult.source.selectorAnchor
          : undefined,
      constraint: simplifyConstraint(selectorQueryResult),
      outcome: selectorQueryResult.outcome,
      status: selectorQueryResult.status,
      confidence: selectorQueryResult.confidence,
      traces: includeTraces ? [...selectorQueryResult.decision.traces] : [],
      sourceResult: selectorQueryResult,
    };

    if (stylesheetId) {
      pushMapValue(indexes.selectorQueriesByStylesheetId, stylesheetId, query.id);
      stylesheetById.get(stylesheetId)?.selectors.push(query.id);
    }

    return query;
  });

  sortIndexValues(indexes.selectorQueriesByStylesheetId);
  return selectorQueries.sort(compareById);
}

export function buildSelectorBranches(
  selectorQueries: SelectorQueryAnalysis[],
): SelectorBranchAnalysis[] {
  return selectorQueries
    .filter((query) => query.sourceResult.source.kind === "css-source")
    .flatMap((query, index) => {
      const source = query.sourceResult.source;
      if (source.kind !== "css-source") {
        return [];
      }
      const selectorListText = source.selectorListText ?? query.selectorText;
      const branchIndex = source.branchIndex ?? 0;
      const branchCount = source.branchCount ?? 1;
      const ruleKey = source.ruleKey ?? createSelectorRuleKey(query, index);

      return [
        {
          id: createSelectorBranchId(query, branchIndex, index),
          selectorQueryId: query.id,
          stylesheetId: query.stylesheetId,
          selectorText: query.selectorText,
          selectorListText,
          branchIndex,
          branchCount,
          ruleKey,
          location: query.location,
          constraint: query.constraint,
          outcome: query.outcome,
          status: query.status,
          confidence: query.confidence,
          traces: [...query.traces],
          sourceQuery: query,
        },
      ];
    })
    .sort(compareById);
}
