import ts from "typescript";

import { createModuleId } from "../../pipeline/module-graph/index.js";
import {
  collectExportedComponentDefinitions,
  collectExportedHelperDefinitions,
  collectSameFileComponents,
  type LocalHelperDefinition,
  type SameFileComponentDefinition,
} from "../../pipeline/render-ir/index.js";
import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../pipeline/render-ir/shared/expansionPolicy.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ParsedProjectFile } from "./types.js";

export type ProjectRenderContext = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
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
};

export function buildProjectRenderContext(input: {
  parsedFiles: ParsedProjectFile[];
  moduleGraph: ModuleGraph;
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
      buildAvailableComponentsForFile({
        filePath: parsedFile.filePath,
        localDefinitions: componentDefinitionsByFilePath.get(parsedFile.filePath) ?? [],
        moduleGraph: input.moduleGraph,
        exportedComponentsByFilePath,
      }),
    ]),
  );
  const exportedConstBindingsByFilePath = new Map<string, Map<string, ts.Expression>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedConstBindings(parsedFile.parsedSourceFile),
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
    importedExpressionBindingsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedExpressionBindingsForFile({
          filePath: parsedFile.filePath,
          moduleGraph: input.moduleGraph,
          exportedConstBindingsByFilePath,
        }),
      ]),
    ),
    importedHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedHelperDefinitionsForFile({
          filePath: parsedFile.filePath,
          moduleGraph: input.moduleGraph,
          exportedHelperDefinitionsByFilePath,
        }),
      ]),
    ),
    importedNamespaceExpressionBindingsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceExpressionBindingsForFile({
          filePath: parsedFile.filePath,
          moduleGraph: input.moduleGraph,
          exportedConstBindingsByFilePath,
        }),
      ]),
    ),
    importedNamespaceHelperDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceHelperDefinitionsForFile({
          filePath: parsedFile.filePath,
          moduleGraph: input.moduleGraph,
          exportedHelperDefinitionsByFilePath,
        }),
      ]),
    ),
    importedNamespaceComponentDefinitionsByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [
        parsedFile.filePath,
        buildImportedNamespaceComponentDefinitionsForFile({
          filePath: parsedFile.filePath,
          moduleGraph: input.moduleGraph,
          exportedComponentsByFilePath,
        }),
      ]),
    ),
  };
}

function buildAvailableComponentsForFile(input: {
  filePath: string;
  localDefinitions: SameFileComponentDefinition[];
  moduleGraph: ModuleGraph;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
}): Map<string, SameFileComponentDefinition> {
  const availableComponents = new Map<string, SameFileComponentDefinition>(
    input.localDefinitions.map((definition) => [definition.componentName, definition]),
  );
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return availableComponents;
  }

  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    const exportedComponents =
      input.exportedComponentsByFilePath.get(importedFilePath) ?? new Map();

    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        continue;
      }

      const targetDefinition =
        resolveExportedComponentDefinition({
          filePath: importedFilePath,
          exportedName: importedName.importedName,
          moduleGraph: input.moduleGraph,
          exportedComponentsByFilePath: input.exportedComponentsByFilePath,
          visitedExports: new Set([`${input.filePath}:${importedName.importedName}`]),
          currentDepth: 0,
        }) ?? exportedComponents.get(importedName.importedName);
      if (!targetDefinition) {
        continue;
      }

      availableComponents.set(importedName.localName, targetDefinition);
    }
  }

  return availableComponents;
}

function buildImportedExpressionBindingsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedConstBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
}): Map<string, ts.Expression> {
  return collectTransitiveImportedExpressionBindings({
    filePath: input.filePath,
    moduleGraph: input.moduleGraph,
    exportedConstBindingsByFilePath: input.exportedConstBindingsByFilePath,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: 0,
  });
}

function buildImportedHelperDefinitionsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
}): Map<string, LocalHelperDefinition> {
  return collectTransitiveImportedHelperDefinitions({
    filePath: input.filePath,
    moduleGraph: input.moduleGraph,
    exportedHelperDefinitionsByFilePath: input.exportedHelperDefinitionsByFilePath,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: 0,
  });
}

function buildImportedNamespaceExpressionBindingsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedConstBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
}): Map<string, Map<string, ts.Expression>> {
  return buildImportedNamespaceBindingsForFile({
    ...input,
    collectDirectExportedNames: (filePath) =>
      new Set(input.exportedConstBindingsByFilePath.get(filePath)?.keys() ?? []),
    resolveExportedValue: ({ filePath, exportedName }) =>
      resolveExportedExpressionBinding({
        filePath,
        exportedName,
        moduleGraph: input.moduleGraph,
        exportedConstBindingsByFilePath: input.exportedConstBindingsByFilePath,
        visitedExports: new Set([`${filePath}:${exportedName}`]),
        currentDepth: 0,
      }),
  });
}

function buildImportedNamespaceHelperDefinitionsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
}): Map<string, Map<string, LocalHelperDefinition>> {
  return buildImportedNamespaceBindingsForFile({
    ...input,
    collectDirectExportedNames: (filePath) =>
      new Set(input.exportedHelperDefinitionsByFilePath.get(filePath)?.keys() ?? []),
    resolveExportedValue: ({ filePath, exportedName }) =>
      resolveExportedHelperDefinition({
        filePath,
        exportedName,
        moduleGraph: input.moduleGraph,
        exportedHelperDefinitionsByFilePath: input.exportedHelperDefinitionsByFilePath,
        visitedExports: new Set([`${filePath}:${exportedName}`]),
        currentDepth: 0,
      }),
  });
}

function buildImportedNamespaceComponentDefinitionsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
}): Map<string, Map<string, SameFileComponentDefinition>> {
  return buildImportedNamespaceBindingsForFile({
    ...input,
    collectDirectExportedNames: (filePath) =>
      new Set(input.exportedComponentsByFilePath.get(filePath)?.keys() ?? []),
    resolveExportedValue: ({ filePath, exportedName }) =>
      resolveExportedComponentDefinition({
        filePath,
        exportedName,
        moduleGraph: input.moduleGraph,
        exportedComponentsByFilePath: input.exportedComponentsByFilePath,
        visitedExports: new Set([`${filePath}:${exportedName}`]),
        currentDepth: 0,
      }),
  });
}

function buildImportedNamespaceBindingsForFile<T>(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  collectDirectExportedNames: (filePath: string) => Set<string>;
  resolveExportedValue: (input: { filePath: string; exportedName: string }) => T | undefined;
}): Map<string, Map<string, T>> {
  const namespaceBindings = new Map<string, Map<string, T>>();
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return namespaceBindings;
  }

  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        const resolvedNamespaceBundle = resolveNamespaceBundle({
          filePath: importedFilePath,
          moduleGraph: input.moduleGraph,
          collectDirectExportedNames: input.collectDirectExportedNames,
          resolveExportedValue: input.resolveExportedValue,
          currentDepth: 0,
        });
        if (resolvedNamespaceBundle) {
          namespaceBindings.set(importedName.localName, resolvedNamespaceBundle);
        }
        continue;
      }

      const resolvedNamespaceBundle = resolveReexportedNamespaceBundle({
        filePath: importedFilePath,
        exportedName: importedName.importedName,
        moduleGraph: input.moduleGraph,
        collectDirectExportedNames: input.collectDirectExportedNames,
        resolveExportedValue: input.resolveExportedValue,
        visitedNamespaceExports: new Set([`${importedFilePath}:${importedName.importedName}`]),
        currentDepth: 0,
      });
      if (resolvedNamespaceBundle) {
        namespaceBindings.set(importedName.localName, resolvedNamespaceBundle);
      }
    }
  }

  return namespaceBindings;
}

function resolveNamespaceBundle<T>(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  collectDirectExportedNames: (filePath: string) => Set<string>;
  resolveExportedValue: (input: { filePath: string; exportedName: string }) => T | undefined;
  currentDepth: number;
}): Map<string, T> {
  const exportedNames = collectAvailableExportedNames({
    filePath: input.filePath,
    moduleGraph: input.moduleGraph,
    collectDirectExportedNames: input.collectDirectExportedNames,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: 0,
  });
  const resolvedBindings = new Map<string, T>();
  for (const exportedName of exportedNames) {
    if (exportedName === "*") {
      continue;
    }

    const resolvedValue = input.resolveExportedValue({
      filePath: input.filePath,
      exportedName,
    });
    if (resolvedValue) {
      resolvedBindings.set(exportedName, resolvedValue);
    }
  }

  return resolvedBindings;
}

function resolveReexportedNamespaceBundle<T>(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  collectDirectExportedNames: (filePath: string) => Set<string>;
  resolveExportedValue: (input: { filePath: string; exportedName: string }) => T | undefined;
  visitedNamespaceExports: Set<string>;
  currentDepth: number;
}): Map<string, T> | undefined {
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return undefined;
  }

  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return undefined;
  }

  for (const exportRecord of moduleNode.exports) {
    if (
      exportRecord.exportedName !== input.exportedName ||
      exportRecord.reexportKind !== "namespace" ||
      !exportRecord.reexportedModuleId
    ) {
      continue;
    }

    const targetFilePath = exportRecord.reexportedModuleId.replace(/^module:/, "");
    return resolveNamespaceBundle({
      filePath: targetFilePath,
      moduleGraph: input.moduleGraph,
      collectDirectExportedNames: input.collectDirectExportedNames,
      resolveExportedValue: input.resolveExportedValue,
      currentDepth: input.currentDepth + 1,
    });
  }

  for (const exportRecord of moduleNode.exports) {
    if (
      exportRecord.exportedName !== input.exportedName ||
      exportRecord.reexportKind === "namespace" ||
      !exportRecord.reexportedModuleId
    ) {
      continue;
    }

    const sourceExportedName = exportRecord.sourceExportedName ?? exportRecord.exportedName;
    const targetFilePath = exportRecord.reexportedModuleId.replace(/^module:/, "");
    const exportKey = `${targetFilePath}:${sourceExportedName}`;
    if (input.visitedNamespaceExports.has(exportKey)) {
      continue;
    }

    const resolvedBundle = resolveReexportedNamespaceBundle({
      ...input,
      filePath: targetFilePath,
      exportedName: sourceExportedName,
      visitedNamespaceExports: new Set([...input.visitedNamespaceExports, exportKey]),
      currentDepth: input.currentDepth + 1,
    });
    if (resolvedBundle) {
      return resolvedBundle;
    }
  }

  return undefined;
}

function collectTransitiveImportedExpressionBindings(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedConstBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Map<string, ts.Expression> {
  const expressionBindings = new Map<string, ts.Expression>();
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode || input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return expressionBindings;
  }

  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    const exportedConstBindings =
      input.exportedConstBindingsByFilePath.get(importedFilePath) ?? new Map();

    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        continue;
      }

      const exportedExpression =
        resolveExportedExpressionBinding({
          filePath: importedFilePath,
          exportedName: importedName.importedName,
          moduleGraph: input.moduleGraph,
          exportedConstBindingsByFilePath: input.exportedConstBindingsByFilePath,
          visitedExports: new Set([`${input.filePath}:${importedName.importedName}`]),
          currentDepth: 0,
        }) ?? exportedConstBindings.get(importedName.importedName);
      if (!exportedExpression) {
        continue;
      }

      expressionBindings.set(importedName.localName, exportedExpression);
    }

    if (input.visitedFilePaths.has(importedFilePath)) {
      continue;
    }

    const nestedBindings = collectTransitiveImportedExpressionBindings({
      ...input,
      filePath: importedFilePath,
      visitedFilePaths: new Set([...input.visitedFilePaths, importedFilePath]),
      currentDepth: input.currentDepth + 1,
    });

    for (const [identifierName, expression] of nestedBindings.entries()) {
      if (!expressionBindings.has(identifierName)) {
        expressionBindings.set(identifierName, expression);
      }
    }
  }

  return expressionBindings;
}

function collectTransitiveImportedHelperDefinitions(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Map<string, LocalHelperDefinition> {
  const helperDefinitions = new Map<string, LocalHelperDefinition>();
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode || input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return helperDefinitions;
  }

  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    const exportedHelperDefinitions =
      input.exportedHelperDefinitionsByFilePath.get(importedFilePath) ?? new Map();

    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        continue;
      }

      const exportedHelperDefinition =
        resolveExportedHelperDefinition({
          filePath: importedFilePath,
          exportedName: importedName.importedName,
          moduleGraph: input.moduleGraph,
          exportedHelperDefinitionsByFilePath: input.exportedHelperDefinitionsByFilePath,
          visitedExports: new Set([`${input.filePath}:${importedName.importedName}`]),
          currentDepth: 0,
        }) ?? exportedHelperDefinitions.get(importedName.importedName);
      if (!exportedHelperDefinition) {
        continue;
      }

      helperDefinitions.set(importedName.localName, exportedHelperDefinition);
    }

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

function collectExportedConstBindings(parsedSourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  const topLevelConstBindings = new Map<string, ts.Expression>();

  for (const statement of parsedSourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      topLevelConstBindings.set(declaration.name.text, declaration.initializer);

      if (!isExportedStatement(statement)) {
        continue;
      }

      bindings.set(declaration.name.text, declaration.initializer);
    }
  }

  for (const statement of parsedSourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
      continue;
    }

    if (ts.isIdentifier(statement.expression)) {
      const expression = topLevelConstBindings.get(statement.expression.text);
      if (expression) {
        bindings.set("default", expression);
      }

      continue;
    }

    bindings.set("default", statement.expression);
  }

  return bindings;
}

function collectAvailableExportedNames(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  collectDirectExportedNames: (filePath: string) => Set<string>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Set<string> {
  const exportedNames = new Set<string>(input.collectDirectExportedNames(input.filePath));
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode || input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return exportedNames;
  }

  for (const exportRecord of moduleNode.exports) {
    if (exportRecord.exportedName === "*") {
      if (!exportRecord.reexportedModuleId) {
        continue;
      }

      const targetFilePath = exportRecord.reexportedModuleId.replace(/^module:/, "");
      if (input.visitedFilePaths.has(targetFilePath)) {
        continue;
      }

      const nestedNames = collectAvailableExportedNames({
        ...input,
        filePath: targetFilePath,
        visitedFilePaths: new Set([...input.visitedFilePaths, targetFilePath]),
        currentDepth: input.currentDepth + 1,
      });
      for (const nestedName of nestedNames) {
        exportedNames.add(nestedName);
      }

      continue;
    }

    exportedNames.add(exportRecord.exportedName);
  }

  return exportedNames;
}

function resolveExportedComponentDefinition(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  visitedExports: Set<string>;
  currentDepth: number;
}): SameFileComponentDefinition | undefined {
  const localDefinition = input.exportedComponentsByFilePath
    .get(input.filePath)
    ?.get(input.exportedName);
  if (localDefinition) {
    return localDefinition;
  }

  return resolveReexportedValue({
    ...input,
    getLocalExport: (filePath, exportedName) =>
      input.exportedComponentsByFilePath.get(filePath)?.get(exportedName),
  });
}

function resolveExportedExpressionBinding(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  exportedConstBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  visitedExports: Set<string>;
  currentDepth: number;
}): ts.Expression | undefined {
  const localExpression = input.exportedConstBindingsByFilePath
    .get(input.filePath)
    ?.get(input.exportedName);
  if (localExpression) {
    return localExpression;
  }

  return resolveReexportedValue({
    ...input,
    getLocalExport: (filePath, exportedName) =>
      input.exportedConstBindingsByFilePath.get(filePath)?.get(exportedName),
  });
}

function resolveExportedHelperDefinition(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  exportedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  visitedExports: Set<string>;
  currentDepth: number;
}): LocalHelperDefinition | undefined {
  const localHelperDefinition = input.exportedHelperDefinitionsByFilePath
    .get(input.filePath)
    ?.get(input.exportedName);
  if (localHelperDefinition) {
    return localHelperDefinition;
  }

  return resolveReexportedValue({
    ...input,
    getLocalExport: (filePath, exportedName) =>
      input.exportedHelperDefinitionsByFilePath.get(filePath)?.get(exportedName),
  });
}

function resolveReexportedValue<T>(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  visitedExports: Set<string>;
  currentDepth: number;
  getLocalExport: (filePath: string, exportedName: string) => T | undefined;
}): T | undefined {
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return undefined;
  }

  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return undefined;
  }

  for (const exportRecord of moduleNode.exports) {
    if (!exportRecord.reexportedModuleId) {
      continue;
    }

    const targetFilePath = exportRecord.reexportedModuleId.replace(/^module:/, "");

    if (exportRecord.exportedName === input.exportedName) {
      const sourceExportedName = exportRecord.sourceExportedName ?? exportRecord.exportedName;
      const exportKey = `${targetFilePath}:${sourceExportedName}`;
      if (input.visitedExports.has(exportKey)) {
        continue;
      }

      const resolvedValue =
        input.getLocalExport(targetFilePath, sourceExportedName) ??
        resolveReexportedValue({
          ...input,
          filePath: targetFilePath,
          exportedName: sourceExportedName,
          visitedExports: new Set([...input.visitedExports, exportKey]),
          currentDepth: input.currentDepth + 1,
        });
      if (resolvedValue) {
        return resolvedValue;
      }
    }

    if (exportRecord.exportedName !== "*") {
      continue;
    }

    const exportKey = `${targetFilePath}:${input.exportedName}`;
    if (input.visitedExports.has(exportKey)) {
      continue;
    }

    const resolvedValue =
      input.getLocalExport(targetFilePath, input.exportedName) ??
      resolveReexportedValue({
        ...input,
        filePath: targetFilePath,
        exportedName: input.exportedName,
        visitedExports: new Set([...input.visitedExports, exportKey]),
        currentDepth: input.currentDepth + 1,
      });
    if (resolvedValue) {
      return resolvedValue;
    }
  }

  return undefined;
}

function isExportedStatement(
  statement: ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}
