import ts from "typescript";

import { getSymbolAt, type ProjectBindingResolution } from "../../../../symbol-resolution/index.js";
import type { EngineSymbolId } from "../../../../../types/core.js";
import type { ExpressionBindingEntry, LocalHelperDefinition } from "./types.js";

export function indexExpressionBindingsBySymbolId(input: {
  bindingEntries: ExpressionBindingEntry[];
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbolResolution: ProjectBindingResolution;
}): Map<EngineSymbolId, ts.Expression> {
  const bindingsBySymbolId = new Map<EngineSymbolId, ts.Expression>();

  for (const bindingEntry of input.bindingEntries) {
    const symbol = resolveDeclaredValueSymbol({
      declaration: bindingEntry.declaration,
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      symbolResolution: input.symbolResolution,
    });
    if (symbol) {
      bindingsBySymbolId.set(symbol.id, bindingEntry.expression);
    }
  }

  return bindingsBySymbolId;
}

export function resolveDeclaredValueSymbol(input: {
  declaration: ts.Identifier;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbolResolution: ProjectBindingResolution;
}) {
  const declarationLocation = getNodeLocation(input.declaration, input.parsedSourceFile);
  return getSymbolAt({
    symbolResolution: input.symbolResolution,
    filePath: input.filePath,
    line: declarationLocation.line,
    column: declarationLocation.column,
    symbolSpace: "value",
  });
}

export function normalizeHelperDefinitionSymbolBindings(input: {
  helperDefinition: LocalHelperDefinition;
  symbolResolution: ProjectBindingResolution;
}): LocalHelperDefinition {
  return {
    ...input.helperDefinition,
    localExpressionBindingsBySymbolId: indexExpressionBindingsBySymbolId({
      bindingEntries: input.helperDefinition.localExpressionBindingEntries,
      filePath: input.helperDefinition.filePath,
      parsedSourceFile: input.helperDefinition.parsedSourceFile,
      symbolResolution: input.symbolResolution,
    }),
  };
}

function getNodeLocation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): {
  line: number;
  column: number;
} {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: position.line + 1,
    column: position.character + 1,
  };
}
