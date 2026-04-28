import ts from "typescript";

import { detectComponentLikeDeclaration } from "./detectComponentLikeDeclaration.js";
import type { ComponentLikeDefinition } from "./types.js";

export function collectComponentLikeDefinitions(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): ComponentLikeDefinition[] {
  const definitions: ComponentLikeDefinition[] = [];
  const knownComponentNames = new Set<string>();

  for (const statement of input.parsedSourceFile.statements) {
    for (const definition of detectComponentLikeDeclaration({
      statement,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
      knownComponentNames,
    })) {
      definitions.push(definition);
      knownComponentNames.add(definition.componentName);
    }
  }

  return definitions;
}
