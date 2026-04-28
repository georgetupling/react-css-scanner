import ts from "typescript";

import type { ParsedProjectFile } from "../../../entry/stages/types.js";
import { getAllResolvedModuleFacts, type ModuleFacts } from "../../module-facts/index.js";
import type { EngineSymbolId } from "../../../types/core.js";
import { collectExportedExpressionBindings } from "../collectExportedExpressionBindings.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
} from "../types.js";
import { collectTransitiveImportedExpressionBindings } from "./collectImportedExpressionBindings.js";
import {
  resolveImportedBindingFailureForSymbol,
  resolveImportedBindingsForFile,
} from "../value-resolution/resolveImportedBindings.js";
import { resolveNamespaceImportsForFile } from "../value-resolution/resolveNamespaceImports.js";

export function buildProjectBindingResolution(input: {
  parsedFiles: ParsedProjectFile[];
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  moduleFacts: ModuleFacts;
  includeTraces?: boolean;
}): ProjectBindingResolution {
  const includeTraces = input.includeTraces ?? true;
  const resolvedImportedBindingsByFilePath = new Map<string, ResolvedImportedBinding[]>();
  const resolvedImportedComponentBindingsByFilePath = new Map<
    string,
    ResolvedImportedComponentBinding[]
  >();
  const resolvedNamespaceImportsByFilePath = new Map<string, ResolvedNamespaceImport[]>();
  const symbolsByFilePath = cloneSymbolsByFilePath(input.symbolsByFilePath);
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const exportedExpressionBindingsByFilePath = new Map<string, Map<string, ts.Expression>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedExpressionBindings(parsedFile.parsedSourceFile),
    ]),
  );

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    resolvedImportedBindingsByFilePath.set(
      moduleFacts.filePath,
      resolveImportedBindingsForFile({
        filePath: moduleFacts.filePath,
        moduleFacts: input.moduleFacts,
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
        moduleFacts: input.moduleFacts,
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
          moduleFacts: input.moduleFacts,
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

function cloneSymbolsByFilePath(
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>,
): Map<string, Map<EngineSymbolId, EngineSymbol>> {
  return new Map(
    [...symbolsByFilePath.entries()].map(([filePath, fileSymbols]) => [
      filePath,
      new Map(
        [...fileSymbols.entries()].map(([symbolId, symbol]) => [
          symbolId,
          { ...symbol, resolution: { ...symbol.resolution } },
        ]),
      ),
    ]),
  );
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
