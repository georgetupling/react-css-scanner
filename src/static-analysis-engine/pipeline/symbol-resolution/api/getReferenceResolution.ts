import type {
  EngineSymbol,
  ProjectBindingResolution,
  SymbolReference,
  SymbolSpace,
} from "../types.js";
import { getSymbolResolutionInternals } from "../internals.js";
import { findReferenceAtLocation } from "./shared.js";

export function getSymbolReferenceAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
  symbolSpace?: SymbolSpace;
}): SymbolReference | undefined {
  return findReferenceAtLocation({
    referencesByFilePath: getSymbolResolutionInternals(input.symbolResolution).referencesByFilePath,
    filePath: input.filePath,
    line: input.line,
    column: input.column,
    symbolSpace: input.symbolSpace,
  });
}

export function resolveReferenceAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
  symbolSpace?: SymbolSpace;
}): EngineSymbol | undefined {
  const reference = getSymbolReferenceAt(input);
  return reference?.resolvedSymbolId
    ? input.symbolResolution.symbols.get(reference.resolvedSymbolId)
    : undefined;
}
