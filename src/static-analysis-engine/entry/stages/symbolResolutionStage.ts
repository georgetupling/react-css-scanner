import {
  buildProjectBindingResolution,
  collectTopLevelSymbols,
} from "../../pipeline/symbol-resolution/index.js";
import type { EngineSymbol } from "../../pipeline/symbol-resolution/index.js";
import { createModuleFactsModuleId } from "../../pipeline/module-facts/normalize/moduleIds.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { EngineSymbolId } from "../../types/core.js";
import type {
  ParsedProjectFile,
  ProjectSymbolCollection,
  SymbolResolutionStageResult,
} from "./types.js";

export function runSymbolResolutionStage(input: {
  parsedFiles: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
  includeTraces?: boolean;
}): SymbolResolutionStageResult {
  const collectedSymbols = collectProjectSymbols({
    parsedFiles: input.parsedFiles,
    moduleFacts: input.moduleFacts,
  });

  return buildProjectBindingResolution({
    parsedFiles: input.parsedFiles,
    symbolsByFilePath: collectedSymbols.symbolsByFilePath,
    moduleFacts: input.moduleFacts,
    includeTraces: input.includeTraces,
  });
}

function collectProjectSymbols(input: {
  parsedFiles: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
}): ProjectSymbolCollection {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const symbolsByFilePath = new Map<string, Map<EngineSymbolId, EngineSymbol>>();

  for (const parsedFile of input.parsedFiles) {
    const moduleId = createModuleFactsModuleId(parsedFile.filePath);
    const fileSymbols = collectTopLevelSymbols({
      filePath: parsedFile.filePath,
      parsedSourceFile: parsedFile.parsedSourceFile,
      moduleId,
      moduleFacts: input.moduleFacts,
    });
    symbolsByFilePath.set(parsedFile.filePath, fileSymbols);

    for (const [symbolId, symbol] of fileSymbols.entries()) {
      symbols.set(symbolId, symbol);
    }
  }

  return {
    symbols,
    symbolsByFilePath,
  };
}
