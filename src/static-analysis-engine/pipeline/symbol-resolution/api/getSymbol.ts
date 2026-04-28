import type { EngineSymbol, ProjectBindingResolution, SymbolSpace } from "../types.js";
import { getSymbolResolutionInternals } from "../internals.js";
import { findSymbolAtLocation, findSymbolByLocalNameAndSpace } from "./shared.js";

export function getSymbol(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  localName: string;
  symbolSpace: SymbolSpace;
}): EngineSymbol | undefined {
  const internals = getSymbolResolutionInternals(input.symbolResolution);
  return findSymbolByLocalNameAndSpace({
    symbolsByFilePath: internals.allSymbolsByFilePath,
    scopesByFilePath: internals.scopesByFilePath,
    requireModuleScope: true,
    filePath: input.filePath,
    localName: input.localName,
    symbolSpace: input.symbolSpace,
  });
}

export function getSymbolAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
  symbolSpace: SymbolSpace;
}): EngineSymbol | undefined {
  return findSymbolAtLocation({
    symbolsByFilePath: getSymbolResolutionInternals(input.symbolResolution).allSymbolsByFilePath,
    filePath: input.filePath,
    line: input.line,
    column: input.column,
    symbolSpace: input.symbolSpace,
  });
}
