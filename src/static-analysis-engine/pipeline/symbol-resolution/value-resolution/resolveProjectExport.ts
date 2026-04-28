import { createModuleFactsModuleId } from "../../module-facts/normalize/moduleIds.js";
import {
  resolveModuleFactExport,
  type ModuleFacts,
  type ResolvedModuleFactExport,
} from "../../module-facts/index.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { EngineSymbolId } from "../../../types/core.js";
import type { EngineSymbol, ResolvedProjectExport } from "../types.js";

export function resolveImportedModuleFactExport(input: {
  filePath: string;
  exportedName: string;
  moduleFacts: ModuleFacts;
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
    moduleFacts: input.moduleFacts,
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
