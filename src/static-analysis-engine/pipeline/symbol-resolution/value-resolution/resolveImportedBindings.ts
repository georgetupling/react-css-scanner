import {
  getDirectSourceImportFacts,
  getResolvedModuleFacts,
  type ModuleFacts,
} from "../../module-facts/index.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { EngineSymbolId } from "../../../types/core.js";
import type { EngineSymbol, ResolvedImportedBinding } from "../types.js";
import { resolveImportedModuleFactExport } from "./resolveProjectExport.js";

export function resolveImportedBindingsForFile(input: {
  filePath: string;
  moduleFacts: ModuleFacts;
  symbolsByFilePath?: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  includeTraces?: boolean;
}): ResolvedImportedBinding[] {
  const includeTraces = input.includeTraces ?? true;
  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
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
    moduleFacts: input.moduleFacts,
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
        moduleFacts: input.moduleFacts,
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

export function resolveImportedBindingFailureForSymbol(input: {
  symbol: EngineSymbol;
  moduleFacts: ModuleFacts;
  filePath: string;
  includeTraces?: boolean;
}): { reason: string; traces: AnalysisTrace[] } | undefined {
  if (input.symbol.resolution.kind !== "imported") {
    return undefined;
  }

  const moduleFacts = getResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
    filePath: input.filePath,
  });
  if (!moduleFacts) {
    return undefined;
  }

  for (const importFact of getDirectSourceImportFacts({
    moduleFacts: input.moduleFacts,
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
      moduleFacts: input.moduleFacts,
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
