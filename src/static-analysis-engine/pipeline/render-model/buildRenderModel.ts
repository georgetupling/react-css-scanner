import ts from "typescript";

import { collectUnsupportedClassReferences } from "./class-reference-diagnostics/index.js";
import { buildProjectComponentAvailability, buildRenderGraph } from "./render-graph/index.js";
import {
  buildProjectRenderBindings,
  buildProjectRenderDefinitions,
  buildSameFileRenderSubtrees,
} from "./render-ir/index.js";
import type { UnsupportedClassReferenceDiagnostic } from "./class-reference-diagnostics/index.js";
import type { RenderGraph } from "./render-graph/index.js";
import type {
  LocalHelperDefinition,
  RenderSubtree,
  SameFileComponentDefinition,
} from "./render-ir/index.js";
import type { ProjectBindingResolution } from "../symbol-resolution/index.js";

export type RenderModelBuildInput = {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
  symbolResolution: ProjectBindingResolution;
};

export type RenderModel = {
  renderSubtrees: RenderSubtree[];
  renderGraph: RenderGraph;
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
};

export function buildRenderModel(input: RenderModelBuildInput): RenderModel {
  const filePaths = input.parsedFiles.map((parsedFile) => parsedFile.filePath);
  const renderDefinitions = buildProjectRenderDefinitions({
    parsedFiles: input.parsedFiles,
  });
  const renderBindings = buildProjectRenderBindings({
    filePaths,
    exportedExpressionBindingsByFilePath:
      input.symbolResolution.exportedExpressionBindingsByFilePath,
    resolvedImportedBindingsByFilePath: input.symbolResolution.resolvedImportedBindingsByFilePath,
    exportedHelperDefinitionsByFilePath: renderDefinitions.exportedHelperDefinitionsByFilePath,
    resolvedNamespaceImportsByFilePath: input.symbolResolution.resolvedNamespaceImportsByFilePath,
  });
  const componentAvailability = buildProjectComponentAvailability({
    filePaths,
    componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
    exportedComponentsByFilePath: renderDefinitions.exportedComponentsByFilePath,
    resolvedImportedComponentBindingsByFilePath:
      input.symbolResolution.resolvedImportedComponentBindingsByFilePath,
    resolvedNamespaceImportsByFilePath: input.symbolResolution.resolvedNamespaceImportsByFilePath,
  });
  const renderSubtrees = buildRenderSubtrees({
    componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
    componentsByFilePath: componentAvailability.componentsByFilePath,
    importedExpressionBindingsByFilePath:
      input.symbolResolution.importedExpressionBindingsByFilePath,
    importedHelperDefinitionsByFilePath: renderBindings.importedHelperDefinitionsByFilePath,
    importedNamespaceExpressionBindingsByFilePath:
      renderBindings.importedNamespaceExpressionBindingsByFilePath,
    importedNamespaceHelperDefinitionsByFilePath:
      renderBindings.importedNamespaceHelperDefinitionsByFilePath,
    importedNamespaceComponentDefinitionsByFilePath:
      componentAvailability.importedNamespaceComponentDefinitionsByFilePath,
  });
  const renderGraph = buildRenderGraph({
    renderSubtrees,
  });
  const unsupportedClassReferences = collectUnsupportedClassReferences({
    parsedFiles: input.parsedFiles,
    renderSubtrees,
  });

  return {
    renderSubtrees,
    renderGraph,
    unsupportedClassReferences,
  };
}

function buildRenderSubtrees(input: {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  importedNamespaceExpressionBindingsByFilePath: Map<
    string,
    Map<string, Map<string, ts.Expression>>
  >;
  importedNamespaceHelperDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, LocalHelperDefinition>>
  >;
  importedNamespaceComponentDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
}): RenderSubtree[] {
  return [...input.componentDefinitionsByFilePath.entries()].flatMap(
    ([filePath, componentDefinitions]) =>
      buildSameFileRenderSubtrees({
        filePath,
        parsedSourceFile:
          componentDefinitions[0]?.parsedSourceFile ??
          ts.createSourceFile(filePath, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
        componentDefinitions,
        componentsByFilePath: input.componentsByFilePath,
        importedExpressionBindings:
          input.importedExpressionBindingsByFilePath.get(filePath) ?? new Map(),
        importedHelperDefinitions:
          input.importedHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
        importedNamespaceExpressionBindings:
          input.importedNamespaceExpressionBindingsByFilePath.get(filePath) ?? new Map(),
        importedNamespaceHelperDefinitions:
          input.importedNamespaceHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
        importedNamespaceComponentDefinitions:
          input.importedNamespaceComponentDefinitionsByFilePath.get(filePath) ?? new Map(),
      }),
  );
}
