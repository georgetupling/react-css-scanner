import ts from "typescript";

import {
  resolveAliasedSymbol,
  resolveReferenceAt,
  type EngineSymbol,
  type ProjectBindingResolution,
} from "../../../symbol-resolution/index.js";
import { toSourceAnchor } from "./renderIrUtils.js";

export function resolveAliasedValueSymbolForIdentifier(input: {
  identifier: ts.Identifier;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbolResolution: ProjectBindingResolution;
}): EngineSymbol | undefined {
  const location = toSourceAnchor(input.identifier, input.parsedSourceFile, input.filePath);
  const resolvedSymbol = resolveReferenceAt({
    symbolResolution: input.symbolResolution,
    filePath: input.filePath,
    line: location.startLine,
    column: location.startColumn,
    symbolSpace: "value",
  });
  if (!resolvedSymbol) {
    return undefined;
  }

  return (
    resolveAliasedSymbol({
      symbolResolution: input.symbolResolution,
      symbolId: resolvedSymbol.id,
    }) ?? resolvedSymbol
  );
}
