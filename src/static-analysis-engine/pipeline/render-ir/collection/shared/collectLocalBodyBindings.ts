import ts from "typescript";

import type { LocalHelperDefinition } from "./types.js";
import { summarizeFunctionExpressionHelperDefinition } from "../summarization/summarizeLocalHelperDefinition.js";

export function collectLocalBodyBindings(
  declarationList: ts.VariableDeclarationList,
  bindings: Map<string, ts.Expression>,
  localHelperDefinitions: Map<string, LocalHelperDefinition>,
): void {
  for (const declaration of declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }

    const helperDefinition = summarizeFunctionExpressionHelperDefinition(
      declaration.name.text,
      declaration.getSourceFile().fileName,
      declaration.getSourceFile(),
      declaration.initializer,
    );
    if (helperDefinition) {
      localHelperDefinitions.set(helperDefinition.helperName, helperDefinition);
      continue;
    }

    bindings.set(declaration.name.text, declaration.initializer);
  }
}

export function isConstDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}
