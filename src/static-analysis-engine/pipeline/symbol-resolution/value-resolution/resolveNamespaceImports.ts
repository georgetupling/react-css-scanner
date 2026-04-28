import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../../libraries/policy/index.js";
import {
  collectAvailableExportedNames,
  getDirectSourceImportFacts,
  getResolvedModuleFacts,
  type ModuleFacts,
} from "../../module-facts/index.js";
import type { EngineSymbolId } from "../../../types/core.js";
import type {
  EngineSymbol,
  ResolvedNamespaceImport,
  ResolvedNamespaceMemberResult,
} from "../types.js";
import { createSymbolResolutionTrace } from "../traces/createSymbolResolutionTrace.js";
import { normalizeValueResolutionReason } from "./resolveImportedBindings.js";
import { resolveImportedModuleFactExport } from "./resolveProjectExport.js";

export function resolveNamespaceImportsForFile(input: {
  filePath: string;
  moduleFacts: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  includeTraces?: boolean;
}): ResolvedNamespaceImport[] {
  const includeTraces = input.includeTraces ?? true;
  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return [];
  }

  const namespaceImports: ResolvedNamespaceImport[] = [];
  for (const importFact of getDirectSourceImportFacts({
    moduleFacts: input.moduleFacts,
    filePath: input.filePath,
  })) {
    const importedFilePath = importFact.resolution.resolvedFilePath;
    if (!importedFilePath) {
      continue;
    }

    for (const importedBinding of importFact.importedBindings) {
      if (importedBinding.importedName === "*") {
        const localSymbolId = findLocalNamespaceImportSymbolId({
          symbolsByFilePath: input.symbolsByFilePath,
          filePath: input.filePath,
          localName: importedBinding.localName,
        });
        namespaceImports.push({
          localName: importedBinding.localName,
          localSymbolId,
          members: resolveNamespaceBundle({
            filePath: importedFilePath,
            moduleFacts: input.moduleFacts,
            symbolsByFilePath: input.symbolsByFilePath,
            currentDepth: 0,
            includeTraces,
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
        moduleFacts: input.moduleFacts,
        symbolsByFilePath: input.symbolsByFilePath,
        visitedNamespaceExports: new Set([`${importedFilePath}:${importedBinding.importedName}`]),
        currentDepth: 0,
        includeTraces,
      });
      if (!resolvedNamespaceImport) {
        continue;
      }

      namespaceImports.push({
        localName: importedBinding.localName,
        localSymbolId: findLocalNamespaceImportSymbolId({
          symbolsByFilePath: input.symbolsByFilePath,
          filePath: input.filePath,
          localName: importedBinding.localName,
        }),
        members: resolvedNamespaceImport,
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

function findLocalNamespaceImportSymbolId(input: {
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  filePath: string;
  localName: string;
}): EngineSymbolId | undefined {
  const fileSymbols = input.symbolsByFilePath?.get(input.filePath);
  if (!fileSymbols) {
    return undefined;
  }

  for (const symbol of fileSymbols.values()) {
    if (
      symbol.symbolSpace === "value" &&
      symbol.localName === input.localName &&
      symbol.resolution.kind === "imported"
    ) {
      return symbol.id;
    }
  }

  return undefined;
}

function resolveNamedNamespaceImport(input: {
  filePath: string;
  exportedName: string;
  moduleFacts: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  visitedNamespaceExports: Set<string>;
  currentDepth: number;
  includeTraces: boolean;
}): Map<string, ResolvedNamespaceMemberResult> | undefined {
  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return undefined;
  }

  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
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

    return resolveNamespaceBundle({
      filePath: exportRecord.reexport.resolvedFilePath,
      moduleFacts: input.moduleFacts,
      symbolsByFilePath: input.symbolsByFilePath,
      currentDepth: input.currentDepth + 1,
      includeTraces: input.includeTraces,
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
      includeTraces: input.includeTraces,
    });
    if (resolvedBundle) {
      return resolvedBundle;
    }
  }

  return undefined;
}

function resolveNamespaceBundle(input: {
  filePath: string;
  moduleFacts: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  currentDepth: number;
  includeTraces: boolean;
}): Map<string, ResolvedNamespaceMemberResult> {
  const exportedNames = collectAvailableExportedNames({
    filePath: input.filePath,
    moduleFacts: input.moduleFacts,
    visitedFilePaths: new Set([input.filePath]),
    currentDepth: input.currentDepth,
  });
  const resolvedBindings = new Map<string, ResolvedNamespaceMemberResult>();

  for (const exportedName of exportedNames) {
    if (exportedName === "*") {
      continue;
    }

    const resolvedExport = resolveImportedModuleFactExport({
      filePath: input.filePath,
      exportedName,
      moduleFacts: input.moduleFacts,
      symbolsByFilePath: input.symbolsByFilePath,
      visitedExports: new Set([`${input.filePath}:${exportedName}`]),
      currentDepth: input.currentDepth,
      includeTraces: input.includeTraces,
    });
    if (resolvedExport.resolvedExport) {
      resolvedBindings.set(exportedName, {
        kind: "resolved",
        target: resolvedExport.resolvedExport,
      });
      continue;
    }

    resolvedBindings.set(exportedName, {
      kind: "unresolved",
      reason: normalizeValueResolutionReason(resolvedExport.reason),
      traces: resolvedExport.traces,
    });
  }

  return resolvedBindings;
}
