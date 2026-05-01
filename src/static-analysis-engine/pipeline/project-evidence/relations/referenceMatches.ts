import type {
  ClassDefinitionAnalysis,
  ClassReferenceAnalysis,
  ClassReferenceMatchRelation,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  StylesheetReachabilityRelation,
} from "../../project-analysis/index.js";
import {
  collectReferenceClassNames,
  compareById,
  createReachabilityContextKey,
  mergeTraces,
  pushMapValue,
} from "../internal/shared.js";
import { getBestReachabilityForReference } from "./stylesheetReachability.js";

export function buildReferenceMatches(input: {
  references: ClassReferenceAnalysis[];
  definitions: ClassDefinitionAnalysis[];
  reachability: StylesheetReachabilityRelation[];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): ClassReferenceMatchRelation[] {
  const reachabilityByStylesheetAndSource = new Map<string, StylesheetReachabilityRelation[]>();
  const reachabilityByStylesheet = new Map<ProjectAnalysisId, StylesheetReachabilityRelation[]>();
  for (const relation of input.reachability) {
    pushMapValue(reachabilityByStylesheet, relation.stylesheetId, relation);

    if (!relation.sourceFileId && !relation.componentId) {
      continue;
    }

    const keys = [
      relation.sourceFileId
        ? createReachabilityContextKey(relation.stylesheetId, "source", relation.sourceFileId)
        : undefined,
      relation.componentId
        ? createReachabilityContextKey(relation.stylesheetId, "component", relation.componentId)
        : undefined,
    ].filter((key): key is string => Boolean(key));

    for (const key of keys) {
      pushMapValue(reachabilityByStylesheetAndSource, key, relation);
    }
  }

  const matches: ClassReferenceMatchRelation[] = [];

  for (const reference of input.references) {
    for (const className of collectReferenceClassNames(reference)) {
      const candidateDefinitionIds = input.indexes.definitionsByClassName.get(className) ?? [];
      for (const definitionId of candidateDefinitionIds) {
        const definition = input.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          continue;
        }

        const reachability = getBestReachabilityForReference({
          reference,
          stylesheetId: definition.stylesheetId,
          reachabilityByStylesheetAndSource,
          reachabilityByStylesheet,
        });

        matches.push({
          id: `reference-match:${reference.id}:${definition.id}`,
          referenceId: reference.id,
          definitionId: definition.id,
          className,
          referenceClassKind: reference.definiteClassNames.includes(className)
            ? "definite"
            : "possible",
          reachability: reachability.availability,
          matchKind:
            reachability.availability === "definite" ||
            reachability.availability === "possible" ||
            reachability.availability === "unknown"
              ? "reachable-stylesheet"
              : "unreachable-stylesheet",
          reasons:
            reachability.availability === "definite" ||
            reachability.availability === "possible" ||
            reachability.availability === "unknown"
              ? [`class "${className}" is defined in a stylesheet reachable from this reference`]
              : [`class "${className}" is defined, but the defining stylesheet is not reachable`],
          traces: input.includeTraces
            ? mergeTraces([...reference.traces, ...reachability.traces])
            : [],
        });
      }
    }
  }

  return matches.sort(compareById);
}
