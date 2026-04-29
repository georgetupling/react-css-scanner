import ts from "typescript";

import type { EngineModuleId, EngineSymbolId, SourceAnchor } from "../../../../types/core.js";
import type { ScopeId, ScopeKind, SymbolSpace } from "../../../symbol-resolution/types.js";

export function createSymbolId(
  moduleId: EngineModuleId,
  localName: string,
  options?: {
    declaration?: SourceAnchor;
    symbolSpace?: SymbolSpace;
  },
): EngineSymbolId {
  if (!options?.declaration) {
    return `symbol:${moduleId}:${localName}`;
  }

  return [
    "symbol",
    moduleId,
    options.symbolSpace ?? "value",
    localName,
    options.declaration.startLine,
    options.declaration.startColumn,
  ].join(":");
}

export function createScopeId(
  moduleId: EngineModuleId,
  kind: ScopeKind,
  range: SourceAnchor,
): ScopeId {
  return ["scope", moduleId, kind, range.startLine, range.startColumn].join(":");
}

export function toSourceAnchor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function toSourceFileAnchor(sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const end = ts.getLineAndCharacterOfPosition(sourceFile, sourceFile.end);

  return {
    filePath,
    startLine: 1,
    startColumn: 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}
