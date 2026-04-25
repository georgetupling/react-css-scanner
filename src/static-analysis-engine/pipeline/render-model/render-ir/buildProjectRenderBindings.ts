import ts from "typescript";

import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../../libraries/policy/index.js";
import type {
  ResolvedImportedBinding,
  ResolvedNamespaceImport,
} from "../../symbol-resolution/types.js";
import type { LocalHelperDefinition } from "./collection/shared/types.js";

export type ProjectRenderBindings = {
  importedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  importedNamespaceExpressionBindingsByFilePath: Map<
    string,
    Map<string, Map<string, ts.Expression>>
  >;
  importedNamespaceHelperDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, LocalHelperDefinition>>
  >;
};

export function buildProjectRenderBindings(input: {
  filePaths: string[];
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
}): ProjectRenderBindings {
  return {
    importedHelperDefinitionsByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        buildImportedHelperDefinitionsForFile({
          filePath,
          resolvedImportedBindingsByFilePath: input.resolvedImportedBindingsByFilePath,
          exportedHelperDefinitionsByFilePath: input.exportedHelperDefinitionsByFilePath,
        }),
      ]),
    ),
    importedNamespaceExpressionBindingsByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        buildResolvedNamespaceBindingsForFile({
          resolvedNamespaceImports: input.resolvedNamespaceImportsByFilePath.get(filePath) ?? [],
          getResolvedValue: (resolvedExport) =>
            input.exportedExpressionBindingsByFilePath
              .get(resolvedExport.targetFilePath)
              ?.get(resolvedExport.targetExportName),
        }),
      ]),
    ),
    importedNamespaceHelperDefinitionsByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        buildResolvedNamespaceBindingsForFile({
          resolvedNamespaceImports: input.resolvedNamespaceImportsByFilePath.get(filePath) ?? [],
          getResolvedValue: (resolvedExport) =>
            input.exportedHelperDefinitionsByFilePath
              .get(resolvedExport.targetFilePath)
              ?.get(resolvedExport.targetExportName),
        }),
      ]),
    ),
  };
}

function buildImportedHelperDefinitionsForFile(input: {
  filePath: string;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
}): Map<string, LocalHelperDefinition> {
  return collectTransitiveImportedHelperDefinitions({
    filePath: input.filePath,
    resolvedImportedBindingsByFilePath: input.resolvedImportedBindingsByFilePath,
    exportedHelperDefinitionsByFilePath: input.exportedHelperDefinitionsByFilePath,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: 0,
  });
}

function buildResolvedNamespaceBindingsForFile<T>(input: {
  resolvedNamespaceImports: ResolvedNamespaceImport[];
  getResolvedValue: (input: { targetFilePath: string; targetExportName: string }) => T | undefined;
}): Map<string, Map<string, T>> {
  const namespaceBindings = new Map<string, Map<string, T>>();
  for (const namespaceImport of input.resolvedNamespaceImports) {
    const resolvedBindings = new Map<string, T>();
    for (const [exportName, resolvedExport] of namespaceImport.exports.entries()) {
      const resolvedValue = input.getResolvedValue(resolvedExport);
      if (resolvedValue) {
        resolvedBindings.set(exportName, resolvedValue);
      }
    }

    namespaceBindings.set(namespaceImport.localName, resolvedBindings);
  }

  return namespaceBindings;
}

function collectTransitiveImportedHelperDefinitions(input: {
  filePath: string;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Map<string, LocalHelperDefinition> {
  const helperDefinitions = new Map<string, LocalHelperDefinition>();
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return helperDefinitions;
  }

  for (const resolvedBinding of input.resolvedImportedBindingsByFilePath.get(input.filePath) ??
    []) {
    const exportedHelperDefinition = input.exportedHelperDefinitionsByFilePath
      .get(resolvedBinding.targetFilePath)
      ?.get(resolvedBinding.targetExportName);
    if (!exportedHelperDefinition) {
      continue;
    }

    helperDefinitions.set(resolvedBinding.localName, exportedHelperDefinition);

    const importedFilePath = resolvedBinding.targetFilePath;
    if (input.visitedFilePaths.has(importedFilePath)) {
      continue;
    }

    const nestedDefinitions = collectTransitiveImportedHelperDefinitions({
      ...input,
      filePath: importedFilePath,
      visitedFilePaths: new Set([...input.visitedFilePaths, importedFilePath]),
      currentDepth: input.currentDepth + 1,
    });

    for (const [helperName, helperDefinition] of nestedDefinitions.entries()) {
      if (!helperDefinitions.has(helperName)) {
        helperDefinitions.set(helperName, helperDefinition);
      }
    }
  }

  return helperDefinitions;
}
