import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import {
  buildProjectBindingResolution,
  collectTopLevelSymbols,
} from "../../pipeline/symbol-resolution/index.js";
import type { EngineSymbol } from "../../pipeline/symbol-resolution/index.js";
import { createModuleId } from "../../pipeline/module-graph/index.js";
import type { EngineSymbolId } from "../../types/core.js";
import type {
  ParsedProjectFile,
  ProjectSymbolCollection,
  SymbolResolutionStageResult,
} from "./types.js";

export function runSymbolResolutionStage(input: {
  parsedFiles: ParsedProjectFile[];
  moduleGraph: ModuleGraph;
}): SymbolResolutionStageResult {
  const collectedSymbols = collectProjectSymbols({
    parsedFiles: input.parsedFiles,
  });

  return buildProjectBindingResolution({
    moduleGraph: input.moduleGraph,
    symbolsByFilePath: collectedSymbols.symbolsByFilePath,
    parsedSourceFilesByFilePath: new Map(
      input.parsedFiles.map((parsedFile) => [parsedFile.filePath, parsedFile.parsedSourceFile]),
    ),
  });
}

function collectProjectSymbols(input: {
  parsedFiles: ParsedProjectFile[];
}): ProjectSymbolCollection {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const symbolsByFilePath = new Map<string, Map<EngineSymbolId, EngineSymbol>>();

  for (const parsedFile of input.parsedFiles) {
    const moduleId = createModuleId(parsedFile.filePath);
    const fileSymbols = collectTopLevelSymbols({
      filePath: parsedFile.filePath,
      parsedSourceFile: parsedFile.parsedSourceFile,
      moduleId,
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
