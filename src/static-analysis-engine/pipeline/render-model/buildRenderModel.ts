import ts from "typescript";

import { collectUnsupportedClassReferences } from "./class-reference-diagnostics/index.js";
import { buildProjectComponentAvailability, buildRenderGraph } from "./render-graph/index.js";
import {
  buildProjectRenderBindings,
  buildProjectRenderDefinitions,
  buildSameFileRenderSubtrees,
} from "./render-ir/index.js";
import {
  getExportedExpressionBindingsForFile,
  getImportedBindingsForFile,
  getImportedComponentBindingsForFile,
  getImportedExpressionBindingsBySymbolIdForFile,
  getNamespaceImportsForFile,
} from "../symbol-resolution/index.js";
import type { UnsupportedClassReferenceDiagnostic } from "./class-reference-diagnostics/index.js";
import type { RenderGraph } from "./render-graph/index.js";
import type {
  LocalHelperDefinition,
  RenderSubtree,
  SameFileComponentDefinition,
} from "./render-ir/index.js";
import type { ProjectBindingResolution } from "../symbol-resolution/index.js";
import type { ModuleFacts } from "../module-facts/index.js";

export type RenderModelBuildInput = {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
  symbolResolution: ProjectBindingResolution;
  moduleFacts: ModuleFacts;
  includeTraces?: boolean;
};

export type RenderModel = {
  renderSubtrees: RenderSubtree[];
  renderGraph: RenderGraph;
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
};

export function buildRenderModel(input: RenderModelBuildInput): RenderModel {
  const includeTraces = input.includeTraces ?? true;
  const filePaths = input.parsedFiles.map((parsedFile) => parsedFile.filePath);
  const renderDefinitions = buildProjectRenderDefinitions({
    parsedFiles: input.parsedFiles,
    moduleFacts: input.moduleFacts,
    symbolResolution: input.symbolResolution,
  });
  const renderBindings = buildProjectRenderBindings({
    filePaths,
    exportedExpressionBindingsByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getExportedExpressionBindingsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
    resolvedImportedBindingsByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getImportedBindingsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
    exportedHelperDefinitionsByFilePath: renderDefinitions.exportedHelperDefinitionsByFilePath,
    resolvedNamespaceImportsByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getNamespaceImportsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
  });
  const componentAvailability = buildProjectComponentAvailability({
    filePaths,
    componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
    exportedComponentsByFilePath: renderDefinitions.exportedComponentsByFilePath,
    resolvedImportedComponentBindingsByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getImportedComponentBindingsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
    resolvedNamespaceImportsByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getNamespaceImportsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
  });
  const renderSubtrees = buildRenderSubtrees({
    symbolResolution: input.symbolResolution,
    componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
    topLevelHelperDefinitionsByFilePath: renderDefinitions.topLevelHelperDefinitionsByFilePath,
    topLevelExpressionBindingsBySymbolIdByFilePath:
      renderDefinitions.topLevelExpressionBindingsBySymbolIdByFilePath,
    componentsByFilePath: componentAvailability.componentsByFilePath,
    importedExpressionBindingsBySymbolIdByFilePath: new Map(
      filePaths.map((filePath) => [
        filePath,
        getImportedExpressionBindingsBySymbolIdForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }),
      ]),
    ),
    importedHelperDefinitionsByFilePath: renderBindings.importedHelperDefinitionsByFilePath,
    importedNamespaceExpressionBindingsBySymbolIdByFilePath:
      renderBindings.importedNamespaceExpressionBindingsBySymbolIdByFilePath,
    importedNamespaceHelperDefinitionsBySymbolIdByFilePath:
      renderBindings.importedNamespaceHelperDefinitionsBySymbolIdByFilePath,
    importedNamespaceComponentDefinitionsBySymbolIdByFilePath:
      componentAvailability.importedNamespaceComponentDefinitionsBySymbolIdByFilePath,
    includeTraces,
  });
  const renderGraph = buildRenderGraph({
    renderSubtrees,
    includeTraces,
  });
  const unsupportedClassReferences = collectUnsupportedClassReferences({
    parsedFiles: input.parsedFiles,
    renderSubtrees,
    includeTraces,
  });

  return {
    renderSubtrees,
    renderGraph,
    unsupportedClassReferences,
  };
}

function buildRenderSubtrees(input: {
  symbolResolution: ProjectBindingResolution;
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  topLevelHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  topLevelExpressionBindingsBySymbolIdByFilePath: Map<string, Map<string, ts.Expression>>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedExpressionBindingsBySymbolIdByFilePath: Map<string, Map<string, ts.Expression>>;
  importedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  importedNamespaceExpressionBindingsBySymbolIdByFilePath: Map<
    string,
    Map<string, Map<string, ts.Expression>>
  >;
  importedNamespaceHelperDefinitionsBySymbolIdByFilePath: Map<
    string,
    Map<string, Map<string, LocalHelperDefinition>>
  >;
  importedNamespaceComponentDefinitionsBySymbolIdByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
  includeTraces: boolean;
}): RenderSubtree[] {
  return [...input.componentDefinitionsByFilePath.entries()].flatMap(
    ([filePath, componentDefinitions]) =>
      buildSameFileRenderSubtrees({
        filePath,
        parsedSourceFile:
          componentDefinitions[0]?.parsedSourceFile ??
          ts.createSourceFile(filePath, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
        symbolResolution: input.symbolResolution,
        componentDefinitions,
        componentsByFilePath: input.componentsByFilePath,
        importedExpressionBindingsBySymbolId:
          input.importedExpressionBindingsBySymbolIdByFilePath.get(filePath) ?? new Map(),
        importedHelperDefinitions:
          input.importedHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
        topLevelHelperDefinitions:
          input.topLevelHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
        topLevelExpressionBindingsBySymbolId:
          input.topLevelExpressionBindingsBySymbolIdByFilePath.get(filePath) ?? new Map(),
        topLevelHelperDefinitionsByFilePath: input.topLevelHelperDefinitionsByFilePath,
        topLevelExpressionBindingsBySymbolIdByFilePath:
          input.topLevelExpressionBindingsBySymbolIdByFilePath,
        importedNamespaceExpressionBindingsBySymbolId:
          input.importedNamespaceExpressionBindingsBySymbolIdByFilePath.get(filePath) ?? new Map(),
        importedNamespaceHelperDefinitionsBySymbolId:
          input.importedNamespaceHelperDefinitionsBySymbolIdByFilePath.get(filePath) ?? new Map(),
        importedNamespaceComponentDefinitionsBySymbolId:
          input.importedNamespaceComponentDefinitionsBySymbolIdByFilePath.get(filePath) ??
          new Map(),
        includeTraces: input.includeTraces,
      }),
  );
}
