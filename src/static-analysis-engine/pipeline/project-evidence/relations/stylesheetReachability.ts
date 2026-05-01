import type { ReachabilityAvailability } from "../../reachability/types.js";
import type {
  ClassReferenceAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  StylesheetReachabilityRelation,
} from "../../project-analysis/index.js";
import {
  compareReachabilityRelations,
  createComponentKey,
  createReachabilityContextKey,
  normalizeProjectPath,
  pushUniqueMapValue,
  sortIndexValues,
  mergeTraces,
} from "../internal/shared.js";
import type { AnalysisTrace } from "../../../types/analysis.js";

export function buildStylesheetReachability(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
  includeTraces: boolean,
): StylesheetReachabilityRelation[] {
  const relations: StylesheetReachabilityRelation[] = [];

  for (const stylesheet of input.reachabilitySummary.stylesheets) {
    const stylesheetId = indexes.stylesheetIdByPath.get(
      normalizeProjectPath(stylesheet.cssFilePath ?? ""),
    );
    if (!stylesheetId) {
      continue;
    }

    if (stylesheet.contexts.length === 0) {
      relations.push({
        stylesheetId,
        availability: stylesheet.availability,
        contexts: [],
        reasons: [...stylesheet.reasons],
        traces: includeTraces ? [...stylesheet.traces] : [],
      });
      continue;
    }

    for (const contextRecord of stylesheet.contexts) {
      const sourceFileId = getSourceFileIdForContext(contextRecord, indexes);
      const componentId = getComponentIdForContext(contextRecord, indexes);
      const relation: StylesheetReachabilityRelation = {
        stylesheetId,
        sourceFileId,
        componentId,
        availability: contextRecord.availability,
        contexts: [contextRecord],
        reasons: [...contextRecord.reasons],
        traces: includeTraces ? [...contextRecord.traces] : [],
      };

      relations.push(relation);

      if (contextRecord.availability !== "unavailable") {
        if (sourceFileId) {
          pushUniqueMapValue(
            indexes.reachableStylesheetsBySourceFileId,
            sourceFileId,
            stylesheetId,
          );
        }
        if (componentId) {
          pushUniqueMapValue(indexes.reachableStylesheetsByComponentId, componentId, stylesheetId);
        }
      }
    }
  }

  sortIndexValues(indexes.reachableStylesheetsBySourceFileId);
  sortIndexValues(indexes.reachableStylesheetsByComponentId);
  return relations.sort(compareReachabilityRelations);
}

export function getBestReachabilityForReference(input: {
  reference: ClassReferenceAnalysis;
  stylesheetId: ProjectAnalysisId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
  reachabilityByStylesheet: Map<ProjectAnalysisId, StylesheetReachabilityRelation[]>;
}): {
  availability: ReachabilityAvailability;
  traces: AnalysisTrace[];
} {
  const candidateRelations = [
    ...getReachabilityRelations({
      stylesheetId: input.stylesheetId,
      kind: "source",
      id: input.reference.sourceFileId,
      reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
    }),
    ...(input.reference.componentId
      ? getReachabilityRelations({
          stylesheetId: input.stylesheetId,
          kind: "component",
          id: input.reference.componentId,
          reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
        })
      : []),
  ];
  const stylesheetRelations = input.reachabilityByStylesheet.get(input.stylesheetId) ?? [];

  const definiteRelations = candidateRelations.filter(
    (relation) => relation.availability === "definite",
  );
  if (definiteRelations.length > 0) {
    return {
      availability: "definite",
      traces: mergeTraces(definiteRelations.flatMap((relation) => relation.traces)),
    };
  }

  const possibleRelations = candidateRelations.filter(
    (relation) => relation.availability === "possible",
  );
  if (possibleRelations.length > 0) {
    return {
      availability: "possible",
      traces: mergeTraces(possibleRelations.flatMap((relation) => relation.traces)),
    };
  }

  const unavailableRelations =
    candidateRelations.length > 0
      ? candidateRelations.filter((relation) => relation.availability === "unavailable")
      : stylesheetRelations.filter((relation) => relation.availability === "unavailable");
  if (unavailableRelations.length > 0) {
    return {
      availability: "unavailable",
      traces: mergeTraces(unavailableRelations.flatMap((relation) => relation.traces)),
    };
  }

  return {
    availability: "unknown",
    traces: mergeTraces(candidateRelations.flatMap((relation) => relation.traces)),
  };
}

export function getReachabilityRelations(input: {
  stylesheetId: ProjectAnalysisId;
  kind: "source" | "component";
  id: ProjectAnalysisId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
}): StylesheetReachabilityRelation[] {
  return (
    input.reachabilityByStylesheetAndSource.get(
      createReachabilityContextKey(input.stylesheetId, input.kind, input.id),
    ) ?? []
  );
}

export function getSourceFileIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectAnalysisIndexes,
): ProjectAnalysisId | undefined {
  const context = contextRecord.context;
  if (
    context.kind === "source-file" ||
    context.kind === "component" ||
    context.kind === "render-subtree-root" ||
    context.kind === "render-region"
  ) {
    return indexes.sourceFileIdByPath.get(normalizeProjectPath(context.filePath));
  }

  return undefined;
}

export function getComponentIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectAnalysisIndexes,
): ProjectAnalysisId | undefined {
  const context = contextRecord.context;
  if (
    (context.kind === "component" ||
      context.kind === "render-subtree-root" ||
      context.kind === "render-region") &&
    (context.componentKey || context.componentName)
  ) {
    if (context.componentKey) {
      return indexes.componentIdByComponentKey.get(context.componentKey);
    }

    if (context.componentName) {
      return indexes.componentIdByFilePathAndName.get(
        createComponentKey(normalizeProjectPath(context.filePath), context.componentName),
      );
    }
  }

  return undefined;
}
