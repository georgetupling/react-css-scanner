import ts from "typescript";
import { isExported, toSourceAnchor, unwrapExpression } from "../shared/utils.js";
import type { SameFileComponentDefinition } from "../shared/types.js";
import { summarizeParameterBinding } from "../summarization/summarizeParameterBinding.js";
import { summarizeComponentBody } from "../summarization/summarizeComponentBody.js";

export function collectSameFileComponents(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): SameFileComponentDefinition[] {
  const components: SameFileComponentDefinition[] = [];

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const bodySummary = summarizeComponentBody(statement.body);
      if (!bodySummary) {
        continue;
      }

      components.push({
        componentName: statement.name.text,
        exported: isExported(statement),
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        sourceAnchor: toSourceAnchor(statement.name, input.parsedSourceFile, input.filePath),
        rootExpression: bodySummary.rootExpression,
        localExpressionBindings: bodySummary.localExpressionBindings,
        localHelperDefinitions: bodySummary.localHelperDefinitions,
        parameterBinding: summarizeParameterBinding(statement.parameters),
      });
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      const componentLikeExpression = unwrapExpression(declaration.initializer);
      if (
        !ts.isArrowFunction(componentLikeExpression) &&
        !ts.isFunctionExpression(componentLikeExpression)
      ) {
        continue;
      }

      const bodySummary = summarizeComponentBody(componentLikeExpression.body);
      if (!bodySummary) {
        continue;
      }

      components.push({
        componentName: declaration.name.text,
        exported: isExported(statement),
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        sourceAnchor: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
        rootExpression: bodySummary.rootExpression,
        localExpressionBindings: bodySummary.localExpressionBindings,
        localHelperDefinitions: bodySummary.localHelperDefinitions,
        parameterBinding: summarizeParameterBinding(componentLikeExpression.parameters),
      });
    }
  }

  return components;
}
export type { SameFileComponentDefinition, LocalHelperDefinition } from "../shared/types.js";
