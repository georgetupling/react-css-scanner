import type { RenderGraphProjectionEdge } from "../../render-structure/index.js";
import type {
  ComponentRenderRelation,
  ModuleImportRelation,
  ProjectEvidenceBuildInput,
  ProjectEvidenceBuilderIndexes,
} from "../analysisTypes.js";
import { createComponentKey, normalizeAnchor, normalizeProjectPath } from "../internal/shared.js";

export function buildModuleImports(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
): ModuleImportRelation[] {
  const imports: ModuleImportRelation[] = [];

  for (const importEdge of input.factGraph.graph.edges.imports) {
    if (importEdge.importerKind !== "source") {
      continue;
    }

    const sourceFileId = indexes.sourceFileIdByPath.get(
      normalizeProjectPath(importEdge.importerFilePath),
    );
    if (!sourceFileId) {
      continue;
    }

    imports.push({
      fromSourceFileId: sourceFileId,
      toModuleId: importEdge.resolvedTargetNodeId,
      resolvedFilePath: importEdge.resolvedFilePath
        ? normalizeProjectPath(importEdge.resolvedFilePath)
        : undefined,
      specifier: importEdge.specifier,
      importKind: importEdge.importKind,
    });
  }

  return imports.sort((left, right) =>
    `${left.fromSourceFileId}:${left.specifier}:${left.importKind}`.localeCompare(
      `${right.fromSourceFileId}:${right.specifier}:${right.importKind}`,
    ),
  );
}

export function buildComponentRenders(
  edges: RenderGraphProjectionEdge[],
  indexes: ProjectEvidenceBuilderIndexes,
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
      location: normalizeAnchor(edge.sourceLocation),
      traces: includeTraces ? [...edge.traces] : [],
    });
  }

  return relations.sort((left, right) =>
    `${left.fromComponentId}:${left.toComponentId ?? ""}:${left.location.startLine}`.localeCompare(
      `${right.fromComponentId}:${right.toComponentId ?? ""}:${right.location.startLine}`,
    ),
  );
}
