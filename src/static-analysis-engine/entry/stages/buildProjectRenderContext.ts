import ts from "typescript";

import type { AnalysisTrace } from "../../types/analysis.js";
import {
  collectExportedComponentDefinitions,
  collectExportedHelperDefinitions,
  collectSameFileComponents,
  type LocalHelperDefinition,
  type SameFileComponentDefinition,
} from "../../pipeline/render-ir/index.js";
import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../libraries/policy/index.js";
import type {
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
} from "../../pipeline/symbol-resolution/index.js";
import type { ParsedProjectFile } from "./types.js";

export type ProjectRenderContext = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedComponentBindingTracesByFilePath: Map<string, Map<string, AnalysisTrace[]>>;
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
};

export function buildProjectRenderContext(input: {
  parsedFiles: ParsedProjectFile[];
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  resolvedImportedComponentBindingsByFilePath: Map<string, ResolvedImportedComponentBinding[]>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
}): ProjectRenderContext {
  const componentDefinitionsByFilePath = new Map<string, SameFileComponentDefinition[]>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectSameFileComponents({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
      }),
    ]),
  );
  const exportedComponentsByFilePath = new Map<string, Map<string, SameFileComponentDefinition>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedComponentDefinitions({
        parsedSourceFile: parsedFile.parsedSourceFile,
        componentDefinitions: componentDefinitionsByFilePath.get(parsedFile.filePath) ?? [],
      }),
    ]),
  );
  const componentsByFilePath = new Map<string, Map<string, SameFileComponentDefinition>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      hydrateAvailableComponentsForFile({
        filePath: parsedFile.filePath,
        localDefinitions: componentDefinitionsByFilePath.get(parsedFile.filePath) ?? [],
        resolvedImportedComponentBindings:
          input.resolvedImportedComponentBindingsByFilePath.get(parsedFile.filePath) ?? [],
        exportedComponentsByFilePath,
      }),
    ]),
  );
  const importedComponentBindingTracesByFilePath = new Map<string, Map<string, AnalysisTrace[]>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      new Map(
        (input.resolvedImportedComponentBindingsByFilePath.get(parsedFile.filePath) ?? []).map(
          (binding) => [binding.localName, binding.traces],
        ),
      ),
    ]),
  );
  const exportedHelperDefinitionsByFilePath = new Map(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedHelperDefinitions({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
      }),
    ]),
  );

  return {
    componentDefinitionsByFilePath,
    exportedComponentsByFilePath,
    componentsByFilePath,
    importedComponentBindingTracesByFilePath,
    importedExpressionBindingsByFilePath: input.importedExpressionBindingsByFilePath,
    importedHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedHelperDefinitionsForFile({
          filePath: parsedFile.filePath,
          resolvedImportedBindingsByFilePath: input.resolvedImportedBindingsByFilePath,
          exportedHelperDefinitionsByFilePath,
        }),
      ]),
    ),
    importedNamespaceExpressionBindingsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceExpressionBindingsForFile({
          filePath: parsedFile.filePath,
          resolvedNamespaceImports:
            input.resolvedNamespaceImportsByFilePath.get(parsedFile.filePath) ?? [],
          exportedExpressionBindingsByFilePath: input.exportedExpressionBindingsByFilePath,
        }),
      ]),
    ),
    importedNamespaceHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceHelperDefinitionsForFile({
          filePath: parsedFile.filePath,
          resolvedNamespaceImports:
            input.resolvedNamespaceImportsByFilePath.get(parsedFile.filePath) ?? [],
          exportedHelperDefinitionsByFilePath,
        }),
      ]),
    ),
    importedNamespaceComponentDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceComponentDefinitionsForFile({
          filePath: parsedFile.filePath,
          resolvedNamespaceImports:
            input.resolvedNamespaceImportsByFilePath.get(parsedFile.filePath) ?? [],
          exportedComponentsByFilePath,
        }),
      ]),
    ),
  };
}

function hydrateAvailableComponentsForFile(input: {
  filePath: string;
  localDefinitions: SameFileComponentDefinition[];
  resolvedImportedComponentBindings: ResolvedImportedComponentBinding[];
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
}): Map<string, SameFileComponentDefinition> {
  const availableComponents = new Map<string, SameFileComponentDefinition>(
    input.localDefinitions.map((definition) => [definition.componentName, definition]),
  );
  for (const resolvedBinding of input.resolvedImportedComponentBindings) {
    const targetDefinition = input.exportedComponentsByFilePath
      .get(resolvedBinding.targetFilePath)
      ?.get(resolvedBinding.targetExportName);
    if (!targetDefinition) {
      continue;
    }

    availableComponents.set(resolvedBinding.localName, targetDefinition);
  }

  return availableComponents;
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

function buildImportedNamespaceExpressionBindingsForFile(input: {
  filePath: string;
  resolvedNamespaceImports: ResolvedNamespaceImport[];
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
}): Map<string, Map<string, ts.Expression>> {
  return buildResolvedNamespaceBindingsForFile({
    resolvedNamespaceImports: input.resolvedNamespaceImports,
    getResolvedValue: (resolvedExport) =>
      input.exportedExpressionBindingsByFilePath
        .get(resolvedExport.targetFilePath)
        ?.get(resolvedExport.targetExportName),
  });
}

function buildImportedNamespaceHelperDefinitionsForFile(input: {
  filePath: string;
  resolvedNamespaceImports: ResolvedNamespaceImport[];
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
}): Map<string, Map<string, LocalHelperDefinition>> {
  return buildResolvedNamespaceBindingsForFile({
    resolvedNamespaceImports: input.resolvedNamespaceImports,
    getResolvedValue: (resolvedExport) =>
      input.exportedHelperDefinitionsByFilePath
        .get(resolvedExport.targetFilePath)
        ?.get(resolvedExport.targetExportName),
  });
}

function buildImportedNamespaceComponentDefinitionsForFile(input: {
  filePath: string;
  resolvedNamespaceImports: ResolvedNamespaceImport[];
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
}): Map<string, Map<string, SameFileComponentDefinition>> {
  return buildResolvedNamespaceBindingsForFile({
    resolvedNamespaceImports: input.resolvedNamespaceImports,
    getResolvedValue: (resolvedExport) =>
      input.exportedComponentsByFilePath
        .get(resolvedExport.targetFilePath)
        ?.get(resolvedExport.targetExportName),
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
