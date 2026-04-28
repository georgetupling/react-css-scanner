import type { RenderGraphEdge } from "../../render-model/render-graph/types.js";
import { getAllResolvedModuleFacts } from "../../module-facts/index.js";
import type {
  ComponentRenderRelation,
  ModuleImportRelation,
  ProjectAnalysisBuildInput,
  ProjectAnalysisIndexes,
} from "../types.js";
import { createComponentKey, normalizeAnchor, normalizeProjectPath } from "../internal/shared.js";

export function buildModuleImports(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): ModuleImportRelation[] {
  const imports: ModuleImportRelation[] = [];

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    const sourceFileId = indexes.sourceFileIdByPath.get(normalizeProjectPath(moduleFacts.filePath));
    if (!sourceFileId) {
      continue;
    }

    for (const importRecord of moduleFacts.imports) {
      imports.push({
        fromSourceFileId: sourceFileId,
        toModuleId: importRecord.resolution.resolvedModuleId,
        specifier: importRecord.specifier,
        importKind: importRecord.importKind,
      });
    }
  }

  return imports.sort((left, right) =>
    `${left.fromSourceFileId}:${left.specifier}:${left.importKind}`.localeCompare(
      `${right.fromSourceFileId}:${right.specifier}:${right.importKind}`,
    ),
  );
}

export function buildComponentRenders(
  edges: RenderGraphEdge[],
  indexes: ProjectAnalysisIndexes,
  includeTraces: boolean,
): ComponentRenderRelation[] {
  const relations: ComponentRenderRelation[] = [];

  for (const edge of edges) {
    const fromComponentId =
      indexes.componentIdByComponentKey.get(edge.fromComponentKey) ??
      indexes.componentIdByFilePathAndName.get(
        createComponentKey(normalizeProjectPath(edge.fromFilePath), edge.fromComponentName),
      );
    if (!fromComponentId) {
      continue;
    }

    const toComponentId = edge.toComponentKey
      ? indexes.componentIdByComponentKey.get(edge.toComponentKey)
      : edge.toFilePath
        ? indexes.componentIdByFilePathAndName.get(
            createComponentKey(normalizeProjectPath(edge.toFilePath), edge.toComponentName),
          )
        : undefined;

    relations.push({
      fromComponentId,
      toComponentId,
      renderPath: edge.renderPath,
      resolution: edge.resolution,
      location: normalizeAnchor(edge.sourceAnchor),
      traces: includeTraces ? [...edge.traces] : [],
    });
  }

  return relations.sort((left, right) =>
    `${left.fromComponentId}:${left.toComponentId ?? ""}:${left.location.startLine}`.localeCompare(
      `${right.fromComponentId}:${right.toComponentId ?? ""}:${right.location.startLine}`,
    ),
  );
}
