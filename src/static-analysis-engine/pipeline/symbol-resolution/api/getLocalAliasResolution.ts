import type { EngineSymbol, LocalAliasResolution, ProjectBindingResolution } from "../types.js";
import { getSymbolResolutionInternals } from "../internals.js";
import { containsPosition } from "./shared.js";

export function getLocalAliasResolutionsForFile(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
}): LocalAliasResolution[] {
  return [
    ...(getSymbolResolutionInternals(input.symbolResolution).localAliasesByFilePath.get(
      input.filePath,
    ) ?? []),
  ];
}

export function getLocalAliasAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
}): LocalAliasResolution | undefined {
  return getLocalAliasResolutionsForFile(input).find((alias) =>
    containsPosition(alias.location, input.line, input.column),
  );
}

export function resolveLocalAliasAt(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  line: number;
  column: number;
}): EngineSymbol | undefined {
  const alias = getLocalAliasAt(input);
  return alias?.kind === "resolved-alias"
    ? input.symbolResolution.symbols.get(alias.targetSymbolId)
    : undefined;
}

export function resolveAliasedSymbol(input: {
  symbolResolution: ProjectBindingResolution;
  symbolId: string;
}): EngineSymbol | undefined {
  let currentSymbol = input.symbolResolution.symbols.get(input.symbolId);
  if (!currentSymbol) {
    return undefined;
  }

  const visitedSymbolIds = new Set([currentSymbol.id]);
  while (true) {
    const currentSymbolId = currentSymbol.id;
    const fileAliases =
      getSymbolResolutionInternals(input.symbolResolution).localAliasesByFilePath.get(
        currentSymbol.declaration.filePath,
      ) ?? [];
    const alias = fileAliases.find(
      (candidate): candidate is Extract<LocalAliasResolution, { kind: "resolved-alias" }> =>
        candidate.kind === "resolved-alias" && candidate.sourceSymbolId === currentSymbolId,
    );
    if (!alias) {
      return currentSymbol;
    }

    const nextSymbol = input.symbolResolution.symbols.get(alias.targetSymbolId);
    if (!nextSymbol || visitedSymbolIds.has(nextSymbol.id)) {
      return currentSymbol;
    }

    visitedSymbolIds.add(nextSymbol.id);
    currentSymbol = nextSymbol;
  }
}
