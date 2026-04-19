import ts from "typescript";

import { createModuleId } from "../module-graph/index.js";
import type { ModuleGraph } from "../module-graph/types.js";
import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../render-ir/shared/expansionPolicy.js";
import type { EngineSymbolId } from "../../types/core.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
} from "./types.js";

export function buildProjectBindingResolution(input: {
  moduleGraph: ModuleGraph;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  parsedSourceFilesByFilePath?: Map<string, ts.SourceFile>;
}): ProjectBindingResolution {
  const resolvedImportedBindingsByFilePath = new Map<string, ResolvedImportedBinding[]>();
  const resolvedImportedComponentBindingsByFilePath = new Map<
    string,
    ResolvedImportedComponentBinding[]
  >();
  const resolvedNamespaceImportsByFilePath = new Map<string, ResolvedNamespaceImport[]>();
  const symbolsByFilePath = new Map<string, Map<EngineSymbolId, EngineSymbol>>(
    [...input.symbolsByFilePath.entries()].map(([filePath, fileSymbols]) => [
      filePath,
      new Map(
        [...fileSymbols.entries()].map(([symbolId, symbol]) => [
          symbolId,
          { ...symbol, resolution: { ...symbol.resolution } },
        ]),
      ),
    ]),
  );
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const exportedConstBindingsByFilePath = new Map<string, Map<string, ts.Expression>>(
    [...symbolsByFilePath.keys()].map((filePath) => [
      filePath,
      collectExportedConstBindings(input.parsedSourceFilesByFilePath?.get(filePath)),
    ]),
  );

  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    resolvedImportedBindingsByFilePath.set(
      moduleNode.filePath,
      resolveImportedBindingsForFile({
        filePath: moduleNode.filePath,
        moduleGraph: input.moduleGraph,
      }),
    );
    resolvedImportedComponentBindingsByFilePath.set(
      moduleNode.filePath,
      (resolvedImportedBindingsByFilePath.get(moduleNode.filePath) ?? []).filter((binding) =>
        isResolvedComponentBinding(binding, symbolsByFilePath),
      ),
    );
    resolvedNamespaceImportsByFilePath.set(
      moduleNode.filePath,
      resolveNamespaceImportsForFile({
        filePath: moduleNode.filePath,
        moduleGraph: input.moduleGraph,
      }),
    );

    const fileSymbols = symbolsByFilePath.get(moduleNode.filePath);
    if (!fileSymbols) {
      continue;
    }

    const importedBindingsByLocalName = new Map(
      (resolvedImportedBindingsByFilePath.get(moduleNode.filePath) ?? []).map((binding) => [
        binding.localName,
        binding,
      ]),
    );
    for (const [symbolId, symbol] of fileSymbols.entries()) {
      if (symbol.resolution.kind !== "imported") {
        symbols.set(symbolId, symbol);
        continue;
      }

      const resolvedBinding = importedBindingsByLocalName.get(symbol.localName);
      if (!resolvedBinding) {
        symbols.set(symbolId, symbol);
        continue;
      }

      const enrichedSymbol: EngineSymbol = {
        ...symbol,
        resolution: {
          kind: "imported",
          targetModuleId: resolvedBinding.targetModuleId,
          targetSymbolId: resolvedBinding.targetSymbolId,
        },
      };
      fileSymbols.set(symbolId, enrichedSymbol);
      symbols.set(symbolId, enrichedSymbol);
    }
  }

  for (const fileSymbols of symbolsByFilePath.values()) {
    for (const [symbolId, symbol] of fileSymbols.entries()) {
      if (!symbols.has(symbolId)) {
        symbols.set(symbolId, symbol);
      }
    }
  }

  return {
    symbols,
    symbolsByFilePath,
    resolvedImportedBindingsByFilePath,
    resolvedImportedComponentBindingsByFilePath,
    resolvedNamespaceImportsByFilePath,
    exportedExpressionBindingsByFilePath: exportedConstBindingsByFilePath,
    importedExpressionBindingsByFilePath: new Map(
      [...symbolsByFilePath.keys()].map((filePath) => [
        filePath,
        collectTransitiveImportedExpressionBindings({
          filePath,
          resolvedImportedBindingsByFilePath,
          exportedConstBindingsByFilePath,
          visitedFilePaths: new Set([filePath]),
          currentDepth: 0,
        }),
      ]),
    ),
  };
}

function isResolvedComponentBinding(
  binding: ResolvedImportedBinding,
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>,
): boolean {
  if (!binding.targetSymbolId) {
    return false;
  }

  return (
    symbolsByFilePath.get(binding.targetFilePath)?.get(binding.targetSymbolId)?.kind === "component"
  );
}

export function resolveImportedBindingsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
}): ResolvedImportedBinding[] {
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return [];
  }

  const resolvedBindings: ResolvedImportedBinding[] = [];
  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        continue;
      }

      const resolvedExport = resolveProjectExport({
        filePath: importedFilePath,
        exportedName: importedName.importedName,
        moduleGraph: input.moduleGraph,
        visitedExports: new Set([`${importedFilePath}:${importedName.importedName}`]),
        currentDepth: 0,
      });
      if (!resolvedExport) {
        continue;
      }

      resolvedBindings.push({
        localName: importedName.localName,
        importedName: importedName.importedName,
        targetModuleId: resolvedExport.targetModuleId,
        targetFilePath: resolvedExport.targetFilePath,
        targetExportName: resolvedExport.targetExportName,
        targetSymbolId: resolvedExport.targetSymbolId,
      });
    }
  }

  return resolvedBindings;
}

export function resolveNamespaceImportsForFile(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
}): ResolvedNamespaceImport[] {
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return [];
  }

  const namespaceImports: ResolvedNamespaceImport[] = [];
  for (const importRecord of moduleNode.imports) {
    if (importRecord.importKind !== "source" || !importRecord.resolvedModuleId) {
      continue;
    }

    const importedFilePath = importRecord.resolvedModuleId.replace(/^module:/, "");
    for (const importedName of importRecord.importedNames) {
      if (importedName.importedName === "*") {
        namespaceImports.push({
          localName: importedName.localName,
          exports: resolveNamespaceBundle({
            filePath: importedFilePath,
            moduleGraph: input.moduleGraph,
            currentDepth: 0,
          }),
        });
        continue;
      }

      const resolvedNamespaceImport = resolveNamedNamespaceImport({
        filePath: importedFilePath,
        exportedName: importedName.importedName,
        moduleGraph: input.moduleGraph,
        visitedNamespaceExports: new Set([`${importedFilePath}:${importedName.importedName}`]),
        currentDepth: 0,
      });
      if (!resolvedNamespaceImport) {
        continue;
      }

      namespaceImports.push({
        localName: importedName.localName,
        exports: resolvedNamespaceImport,
      });
    }
  }

  return namespaceImports;
}

function resolveNamedNamespaceImport(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  visitedNamespaceExports: Set<string>;
  currentDepth: number;
}): Map<string, ResolvedProjectExport> | undefined {
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

    const resolvedBundle = resolveNamedNamespaceImport({
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

function resolveNamespaceBundle(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  currentDepth: number;
}): Map<string, ResolvedProjectExport> {
  const exportedNames = collectAvailableExportedNames({
    filePath: input.filePath,
    moduleGraph: input.moduleGraph,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: input.currentDepth,
  });
  const resolvedBindings = new Map<string, ResolvedProjectExport>();

  for (const exportedName of exportedNames) {
    if (exportedName === "*") {
      continue;
    }

    const resolvedExport = resolveProjectExport({
      filePath: input.filePath,
      exportedName,
      moduleGraph: input.moduleGraph,
      visitedExports: new Set([`${input.filePath}:${exportedName}`]),
      currentDepth: input.currentDepth,
    });
    if (resolvedExport) {
      resolvedBindings.set(exportedName, resolvedExport);
    }
  }

  return resolvedBindings;
}

function collectAvailableExportedNames(input: {
  filePath: string;
  moduleGraph: ModuleGraph;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Set<string> {
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  const exportedNames = new Set<string>(
    moduleNode?.exports.map((exportRecord) => exportRecord.exportedName) ?? [],
  );
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

function resolveProjectExport(input: {
  filePath: string;
  exportedName: string;
  moduleGraph: ModuleGraph;
  visitedExports: Set<string>;
  currentDepth: number;
}): ResolvedProjectExport | undefined {
  const moduleNode = input.moduleGraph.modulesById.get(createModuleId(input.filePath));
  if (!moduleNode) {
    return undefined;
  }

  const directExport = moduleNode.exports.find(
    (exportRecord) =>
      exportRecord.exportedName === input.exportedName && !exportRecord.reexportedModuleId,
  );
  if (directExport) {
    return {
      targetModuleId: moduleNode.id,
      targetFilePath: input.filePath,
      targetExportName: directExport.exportedName,
      targetSymbolId: directExport.localSymbolId,
    };
  }

  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
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

      const resolvedValue = resolveProjectExport({
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

    const resolvedValue = resolveProjectExport({
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

function collectTransitiveImportedExpressionBindings(input: {
  filePath: string;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  exportedConstBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Map<string, ts.Expression> {
  const expressionBindings = new Map<string, ts.Expression>();
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return expressionBindings;
  }

  for (const resolvedBinding of input.resolvedImportedBindingsByFilePath.get(input.filePath) ??
    []) {
    const exportedExpression = input.exportedConstBindingsByFilePath
      .get(resolvedBinding.targetFilePath)
      ?.get(resolvedBinding.targetExportName);
    if (!exportedExpression) {
      continue;
    }

    expressionBindings.set(resolvedBinding.localName, exportedExpression);

    const importedFilePath = resolvedBinding.targetFilePath;
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

function collectExportedConstBindings(
  parsedSourceFile: ts.SourceFile | undefined,
): Map<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  const topLevelConstBindings = new Map<string, ts.Expression>();
  if (!parsedSourceFile) {
    return bindings;
  }

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

function isExportedStatement(
  statement: ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}
