import type { EngineSymbolId, SourceAnchor } from "../../../types/core.js";
import type { EngineSymbol, SourceScope, SymbolSpace, SymbolReference } from "../types.js";

export function findTypeSymbolByLocalName(input: {
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  scopesByFilePath?: Map<string, Map<string, SourceScope>>;
  requireModuleScope?: boolean;
  filePath: string;
  localName: string;
}): EngineSymbol | undefined {
  return findSymbolByLocalNameAndSpace({
    symbolsByFilePath: input.symbolsByFilePath,
    scopesByFilePath: input.scopesByFilePath,
    requireModuleScope: input.requireModuleScope,
    filePath: input.filePath,
    localName: input.localName,
    symbolSpace: "type",
  });
}

export function findSymbolByLocalNameAndSpace(input: {
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  scopesByFilePath?: Map<string, Map<string, SourceScope>>;
  requireModuleScope?: boolean;
  filePath: string;
  localName: string;
  symbolSpace: SymbolSpace;
}): EngineSymbol | undefined {
  for (const symbol of input.symbolsByFilePath.get(input.filePath)?.values() ?? []) {
    if (symbol.localName !== input.localName) {
      continue;
    }

    if (input.symbolSpace === "type" ? isTypeSymbol(symbol) : !isTypeSymbol(symbol)) {
      if (!input.requireModuleScope || isModuleScopeSymbol(symbol, input)) {
        return symbol;
      }
    }
  }

  return undefined;
}

function isTypeSymbol(symbol: EngineSymbol): boolean {
  return symbol.kind === "type-alias" || symbol.kind === "interface";
}

export function collectModuleScopeSymbolsForFile(input: {
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  scopesByFilePath: Map<string, Map<string, SourceScope>>;
  filePath: string;
}): Map<EngineSymbolId, EngineSymbol> {
  return new Map(
    [...(input.symbolsByFilePath.get(input.filePath)?.entries() ?? [])].filter(([, symbol]) =>
      isModuleScopeSymbol(symbol, input),
    ),
  );
}

function isModuleScopeSymbol(
  symbol: EngineSymbol,
  input: {
    scopesByFilePath?: Map<string, Map<string, SourceScope>>;
    filePath: string;
  },
): boolean {
  return input.scopesByFilePath?.get(input.filePath)?.get(symbol.scopeId)?.kind === "module";
}

export function containsPosition(anchor: SourceAnchor, line: number, column: number): boolean {
  const afterStart =
    line > anchor.startLine || (line === anchor.startLine && column >= anchor.startColumn);
  const beforeEnd =
    (anchor.endLine ?? anchor.startLine) > line ||
    ((anchor.endLine ?? anchor.startLine) === line &&
      column <= (anchor.endColumn ?? anchor.startColumn));

  return afterStart && beforeEnd;
}

export function findScopeAtLocation(input: {
  scopesByFilePath: Map<string, Map<string, SourceScope>>;
  filePath: string;
  line: number;
  column: number;
}): SourceScope | undefined {
  let bestScope: SourceScope | undefined;

  for (const scope of input.scopesByFilePath.get(input.filePath)?.values() ?? []) {
    if (!containsPosition(scope.range, input.line, input.column)) {
      continue;
    }

    if (
      !bestScope ||
      compareScopeSpecificity(
        scope,
        bestScope,
        input.scopesByFilePath.get(input.filePath) ?? new Map(),
      ) < 0
    ) {
      bestScope = scope;
    }
  }

  return bestScope;
}

export function findSymbolAtLocation(input: {
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  filePath: string;
  line: number;
  column: number;
  symbolSpace: SymbolSpace;
}): EngineSymbol | undefined {
  let bestSymbol: EngineSymbol | undefined;

  for (const symbol of input.symbolsByFilePath.get(input.filePath)?.values() ?? []) {
    if (
      (input.symbolSpace === "type" ? isTypeSymbol(symbol) : !isTypeSymbol(symbol)) &&
      containsPosition(symbol.declaration, input.line, input.column) &&
      (!bestSymbol || compareAnchorSpecificity(symbol.declaration, bestSymbol.declaration) < 0)
    ) {
      bestSymbol = symbol;
    }
  }

  return bestSymbol;
}

export function findReferenceAtLocation(input: {
  referencesByFilePath: Map<string, SymbolReference[]>;
  filePath: string;
  line: number;
  column: number;
  symbolSpace?: SymbolSpace;
}): SymbolReference | undefined {
  return (input.referencesByFilePath.get(input.filePath) ?? []).find(
    (reference) =>
      containsPosition(reference.location, input.line, input.column) &&
      (!input.symbolSpace || input.symbolSpace === reference.symbolSpace),
  );
}

function compareAnchorSpecificity(left: SourceAnchor, right: SourceAnchor): number {
  const leftSpan = spanSize(left);
  const rightSpan = spanSize(right);

  if (leftSpan !== rightSpan) {
    return leftSpan - rightSpan;
  }

  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine;
  }

  return left.startColumn - right.startColumn;
}

function compareScopeSpecificity(
  left: SourceScope,
  right: SourceScope,
  scopes: Map<string, SourceScope>,
): number {
  const anchorDelta = compareAnchorSpecificity(left.range, right.range);
  if (anchorDelta !== 0) {
    return anchorDelta;
  }

  const depthDelta = scopeDepth(scopes, right.id) - scopeDepth(scopes, left.id);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return left.id.localeCompare(right.id);
}

function spanSize(anchor: SourceAnchor): number {
  return (
    ((anchor.endLine ?? anchor.startLine) - anchor.startLine) * 10000 +
    ((anchor.endColumn ?? anchor.startColumn) - anchor.startColumn)
  );
}

function scopeDepth(scopes: Map<string, SourceScope>, scopeId: string): number {
  let depth = 0;
  let currentScopeId: string | undefined = scopeId;

  while (currentScopeId) {
    const scope = scopes.get(currentScopeId);
    if (!scope?.parentScopeId) {
      break;
    }
    depth += 1;
    currentScopeId = scope.parentScopeId;
  }

  return depth;
}
