import ts from "typescript";

import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../libraries/policy/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import {
  collectAvailableExportedNames,
  getAllResolvedModuleFacts,
  getDirectSourceImportFacts,
  getResolvedModuleFacts,
  resolveModuleFactExport,
  type ResolvedModuleFactExport,
  type ModuleFacts,
} from "../module-facts/index.js";
import { createModuleFactsModuleId } from "../module-facts/normalize/moduleIds.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type { EngineSymbolId } from "../../types/core.js";
import { collectExportedExpressionBindings } from "./collectExportedExpressionBindings.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
} from "./types.js";

export function buildProjectBindingResolution(input: {
  parsedFiles: ParsedProjectFile[];
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  projectResolution: ModuleFacts;
  includeTraces?: boolean;
}): ProjectBindingResolution {
  const includeTraces = input.includeTraces ?? true;
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
  const exportedExpressionBindingsByFilePath = new Map<string, Map<string, ts.Expression>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedExpressionBindings(parsedFile.parsedSourceFile),
    ]),
  );

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.projectResolution,
  })) {
    resolvedImportedBindingsByFilePath.set(
      moduleFacts.filePath,
      resolveImportedBindingsForFile({
        filePath: moduleFacts.filePath,
        projectResolution: input.projectResolution,
        symbolsByFilePath,
        includeTraces,
      }),
    );
    resolvedImportedComponentBindingsByFilePath.set(
      moduleFacts.filePath,
      (resolvedImportedBindingsByFilePath.get(moduleFacts.filePath) ?? []).filter((binding) =>
        isResolvedComponentBinding(binding, symbolsByFilePath),
      ),
    );
    resolvedNamespaceImportsByFilePath.set(
      moduleFacts.filePath,
      resolveNamespaceImportsForFile({
        filePath: moduleFacts.filePath,
        projectResolution: input.projectResolution,
        symbolsByFilePath,
        includeTraces,
      }),
    );

    const fileSymbols = symbolsByFilePath.get(moduleFacts.filePath);
    if (!fileSymbols) {
      continue;
    }

    const importedBindingsByLocalName = new Map(
      (resolvedImportedBindingsByFilePath.get(moduleFacts.filePath) ?? []).map((binding) => [
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
        const unresolvedImportedBinding = resolveImportedBindingFailureForSymbol({
          symbol,
          projectResolution: input.projectResolution,
          filePath: moduleFacts.filePath,
          includeTraces,
        });
        if (unresolvedImportedBinding) {
          const enrichedSymbol: EngineSymbol = {
            ...symbol,
            resolution: {
              kind: "unresolved",
              reason: unresolvedImportedBinding.reason,
              traces: unresolvedImportedBinding.traces,
            },
          };
          fileSymbols.set(symbolId, enrichedSymbol);
          symbols.set(symbolId, enrichedSymbol);
          continue;
        }

        symbols.set(symbolId, symbol);
        continue;
      }

      const enrichedSymbol: EngineSymbol = {
        ...symbol,
        resolution: {
          kind: "imported",
          targetModuleId: resolvedBinding.targetModuleId,
          targetSymbolId: resolvedBinding.targetSymbolId,
          traces: resolvedBinding.traces,
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
    exportedExpressionBindingsByFilePath,
    importedExpressionBindingsByFilePath: new Map(
      [...symbolsByFilePath.keys()].map((filePath) => [
        filePath,
        collectTransitiveImportedExpressionBindings({
          filePath,
          resolvedImportedBindingsByFilePath,
          exportedExpressionBindingsByFilePath,
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
  projectResolution: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  includeTraces?: boolean;
}): ResolvedImportedBinding[] {
  const includeTraces = input.includeTraces ?? true;
  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return [];
  }

  const importSymbolAnchorsByLocalName = new Map(
    [...(input.symbolsByFilePath?.get(input.filePath)?.values() ?? [])]
      .filter((symbol) => symbol.resolution.kind === "imported")
      .map((symbol) => [symbol.localName, symbol.declaration]),
  );
  const resolvedBindings: ResolvedImportedBinding[] = [];
  for (const importFact of getDirectSourceImportFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  })) {
    const importedFilePath = importFact.resolution.resolvedFilePath;
    if (!importedFilePath) {
      continue;
    }

    for (const importedBinding of importFact.importedBindings) {
      if (importedBinding.importedName === "*") {
        continue;
      }

      const resolvedExport = resolveImportedModuleFactExport({
        filePath: importedFilePath,
        exportedName: importedBinding.importedName,
        projectResolution: input.projectResolution,
        symbolsByFilePath: input.symbolsByFilePath,
        visitedExports: new Set([`${importedFilePath}:${importedBinding.importedName}`]),
        currentDepth: 0,
        importAnchor: importSymbolAnchorsByLocalName.get(importedBinding.localName),
        includeTraces,
      });
      if (!resolvedExport.resolvedExport) {
        continue;
      }

      resolvedBindings.push({
        localName: importedBinding.localName,
        importedName: importedBinding.importedName,
        targetModuleId: resolvedExport.resolvedExport.targetModuleId,
        targetFilePath: resolvedExport.resolvedExport.targetFilePath,
        targetExportName: resolvedExport.resolvedExport.targetExportName,
        targetSymbolId: resolvedExport.resolvedExport.targetSymbolId,
        traces: resolvedExport.traces,
      });
    }
  }

  return resolvedBindings;
}

export function resolveNamespaceImportsForFile(input: {
  filePath: string;
  projectResolution: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  includeTraces?: boolean;
}): ResolvedNamespaceImport[] {
  const includeTraces = input.includeTraces ?? true;
  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return [];
  }

  const namespaceImports: ResolvedNamespaceImport[] = [];
  for (const importFact of getDirectSourceImportFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  })) {
    const importedFilePath = importFact.resolution.resolvedFilePath;
    if (!importedFilePath) {
      continue;
    }

    for (const importedBinding of importFact.importedBindings) {
      if (importedBinding.importedName === "*") {
        namespaceImports.push({
          localName: importedBinding.localName,
          exports: resolveNamespaceBundle({
            filePath: importedFilePath,
            projectResolution: input.projectResolution,
            symbolsByFilePath: input.symbolsByFilePath,
            currentDepth: 0,
          }),
          traces: includeTraces
            ? [
                createSymbolResolutionTrace({
                  traceId: `symbol-resolution:namespace-import:${input.filePath}:${importedBinding.localName}`,
                  summary: `resolved namespace import ${importedBinding.localName} from ${importedFilePath}`,
                  metadata: {
                    filePath: input.filePath,
                    localName: importedBinding.localName,
                    targetFilePath: importedFilePath,
                  },
                }),
              ]
            : [],
        });
        continue;
      }

      const resolvedNamespaceImport = resolveNamedNamespaceImport({
        filePath: importedFilePath,
        exportedName: importedBinding.importedName,
        projectResolution: input.projectResolution,
        symbolsByFilePath: input.symbolsByFilePath,
        visitedNamespaceExports: new Set([`${importedFilePath}:${importedBinding.importedName}`]),
        currentDepth: 0,
      });
      if (!resolvedNamespaceImport) {
        continue;
      }

      namespaceImports.push({
        localName: importedBinding.localName,
        exports: resolvedNamespaceImport,
        traces: includeTraces
          ? [
              createSymbolResolutionTrace({
                traceId: `symbol-resolution:namespace-import:${input.filePath}:${importedBinding.localName}`,
                summary: `resolved namespace-like import ${importedBinding.localName} through ${importedFilePath}`,
                metadata: {
                  filePath: input.filePath,
                  localName: importedBinding.localName,
                  targetFilePath: importedFilePath,
                },
              }),
            ]
          : [],
      });
    }
  }

  return namespaceImports;
}

function resolveNamedNamespaceImport(input: {
  filePath: string;
  exportedName: string;
  projectResolution: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  visitedNamespaceExports: Set<string>;
  currentDepth: number;
}): Map<string, ResolvedProjectExport> | undefined {
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return undefined;
  }

  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return undefined;
  }

  for (const exportRecord of moduleFacts.exports) {
    if (
      exportRecord.exportedName !== input.exportedName ||
      exportRecord.reexportKind !== "namespace" ||
      exportRecord.reexport.status !== "resolved" ||
      !exportRecord.reexport.resolvedFilePath
    ) {
      continue;
    }

    const targetFilePath = exportRecord.reexport.resolvedFilePath;

    return resolveNamespaceBundle({
      filePath: targetFilePath,
      projectResolution: input.projectResolution,
      symbolsByFilePath: input.symbolsByFilePath,
      currentDepth: input.currentDepth + 1,
    });
  }

  for (const exportRecord of moduleFacts.exports) {
    if (
      exportRecord.exportedName !== input.exportedName ||
      exportRecord.reexportKind === "namespace" ||
      exportRecord.reexport.status !== "resolved" ||
      !exportRecord.reexport.resolvedFilePath
    ) {
      continue;
    }

    const sourceExportedName = exportRecord.sourceExportedName ?? exportRecord.exportedName;
    const targetFilePath = exportRecord.reexport.resolvedFilePath;

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
  projectResolution: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  currentDepth: number;
}): Map<string, ResolvedProjectExport> {
  const exportedNames = collectAvailableExportedNames({
    filePath: input.filePath,
    moduleFacts: input.projectResolution,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: input.currentDepth,
  });
  const resolvedBindings = new Map<string, ResolvedProjectExport>();

  for (const exportedName of exportedNames) {
    if (exportedName === "*") {
      continue;
    }

    const resolvedExport = resolveImportedModuleFactExport({
      filePath: input.filePath,
      exportedName,
      projectResolution: input.projectResolution,
      symbolsByFilePath: input.symbolsByFilePath,
      visitedExports: new Set([`${input.filePath}:${exportedName}`]),
      currentDepth: input.currentDepth,
    });
    if (resolvedExport.resolvedExport) {
      resolvedBindings.set(exportedName, resolvedExport.resolvedExport);
    }
  }

  return resolvedBindings;
}

function resolveImportedModuleFactExport(input: {
  filePath: string;
  exportedName: string;
  projectResolution: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  visitedExports: Set<string>;
  currentDepth: number;
  importAnchor?: EngineSymbol["declaration"];
  includeTraces?: boolean;
}): {
  resolvedExport?: ResolvedProjectExport;
  traces: AnalysisTrace[];
  reason?: string;
} {
  const resolvedValue = resolveModuleFactExport({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
    exportedName: input.exportedName,
    visitedExports: input.visitedExports,
    currentDepth: input.currentDepth,
    importAnchor: input.importAnchor,
    includeTraces: input.includeTraces,
  });

  return {
    ...resolvedValue,
    resolvedExport: resolvedValue.resolvedExport
      ? toResolvedProjectExport({
          resolvedExport: resolvedValue.resolvedExport,
          symbolsByFilePath: input.symbolsByFilePath,
        })
      : undefined,
  };
}

function toResolvedProjectExport(input: {
  resolvedExport: ResolvedModuleFactExport;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
}): ResolvedProjectExport {
  return {
    targetModuleId: createModuleFactsModuleId(input.resolvedExport.targetFilePath),
    targetFilePath: input.resolvedExport.targetFilePath,
    targetExportName: input.resolvedExport.targetExportName,
    targetSymbolId: input.resolvedExport.targetLocalName
      ? findSymbolIdByLocalName({
          symbolsByFilePath: input.symbolsByFilePath,
          filePath: input.resolvedExport.targetFilePath,
          localName: input.resolvedExport.targetLocalName,
        })
      : undefined,
  };
}

function findSymbolIdByLocalName(input: {
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  filePath: string;
  localName: string;
}): EngineSymbolId | undefined {
  for (const [symbolId, symbol] of input.symbolsByFilePath?.get(input.filePath) ?? []) {
    if (symbol.localName === input.localName) {
      return symbolId;
    }
  }

  return undefined;
}

function resolveImportedBindingFailureForSymbol(input: {
  symbol: EngineSymbol;
  projectResolution: ModuleFacts;
  filePath: string;
  includeTraces?: boolean;
}): { reason: string; traces: AnalysisTrace[] } | undefined {
  if (input.symbol.resolution.kind !== "imported") {
    return undefined;
  }

  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return undefined;
  }

  for (const importFact of getDirectSourceImportFacts({
    moduleFacts: input.projectResolution,
    filePath: input.filePath,
  })) {
    const importedFilePath = importFact.resolution.resolvedFilePath;
    if (!importedFilePath) {
      continue;
    }

    const importedBinding = importFact.importedBindings.find(
      (entry) => entry.localName === input.symbol.localName && entry.importedName !== "*",
    );
    if (!importedBinding) {
      continue;
    }

    const result = resolveImportedModuleFactExport({
      filePath: importedFilePath,
      exportedName: importedBinding.importedName,
      projectResolution: input.projectResolution,
      visitedExports: new Set([`${importedFilePath}:${importedBinding.importedName}`]),
      currentDepth: 0,
      importAnchor: input.symbol.declaration,
      includeTraces: input.includeTraces,
    });
    if (result.resolvedExport) {
      return undefined;
    }

    return {
      reason: result.reason ?? "unresolved-imported-binding",
      traces: result.traces,
    };
  }

  return undefined;
}

function collectTransitiveImportedExpressionBindings(input: {
  filePath: string;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Map<string, ts.Expression> {
  const expressionBindings = new Map<string, ts.Expression>();
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return expressionBindings;
  }

  for (const resolvedBinding of input.resolvedImportedBindingsByFilePath.get(input.filePath) ??
    []) {
    const exportedExpression = input.exportedExpressionBindingsByFilePath
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

function createSymbolResolutionTrace(input: {
  traceId: string;
  summary: string;
  anchor?: EngineSymbol["declaration"];
  metadata?: Record<string, unknown>;
  children?: AnalysisTrace[];
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "symbol-resolution",
    summary: input.summary,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    children: [...(input.children ?? [])],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
