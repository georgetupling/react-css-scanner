import type { ProjectBindingResolution, SourceScope } from "../types.js";
import { getSymbolResolutionInternals } from "../internals.js";
import { findScopeAtLocation } from "./shared.js";

export function getScopeAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
}): SourceScope | undefined {
  return findScopeAtLocation({
    scopesByFilePath: getSymbolResolutionInternals(input.symbolResolution).scopesByFilePath,
    filePath: input.filePath,
    line: input.line,
    column: input.column,
  });
}
