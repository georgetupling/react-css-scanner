import ts from "typescript";

import type { ExpressionBindingEntry, LocalHelperDefinition } from "./types.js";
import { summarizeFunctionExpressionHelperDefinition } from "../summarization/summarizeLocalHelperDefinition.js";

export function collectLocalBodyBindings(
  declarationList: ts.VariableDeclarationList,
  bindings: Map<string, ts.Expression>,
  stringSetBindings: Map<string, string[]>,
  localHelperDefinitions: Map<string, LocalHelperDefinition>,
  finiteStringValuesByObjectName: Map<string, Map<string, string[]>> = new Map(),
  bindingEntries: ExpressionBindingEntry[] = [],
): void {
  for (const declaration of declarationList.declarations) {
    if (!declaration.initializer) {
      continue;
    }

    if (ts.isObjectBindingPattern(declaration.name)) {
      collectDestructuredBindings(
        declaration.name,
        declaration.initializer,
        bindings,
        stringSetBindings,
        finiteStringValuesByObjectName,
        bindingEntries,
      );
      continue;
    }

    if (!ts.isIdentifier(declaration.name)) {
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
    bindingEntries.push({
      localName: declaration.name.text,
      declaration: declaration.name,
      expression: declaration.initializer,
    });
  }
}

export function isConstDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
  return (declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function collectDestructuredBindings(
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression,
  bindings: Map<string, ts.Expression>,
  stringSetBindings: Map<string, string[]>,
  finiteStringValuesByObjectName: Map<string, Map<string, string[]>>,
  bindingEntries: ExpressionBindingEntry[],
): void {
  if (!ts.isIdentifier(initializer)) {
    return;
  }

  const finiteStringValuesByProperty = finiteStringValuesByObjectName.get(initializer.text);

  for (const element of pattern.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
      continue;
    }

    const propertyNameNode = element.propertyName;
    if (
      propertyNameNode &&
      !ts.isIdentifier(propertyNameNode) &&
      !ts.isStringLiteral(propertyNameNode)
    ) {
      continue;
    }

    const propertyName = propertyNameNode?.text ?? element.name.text;
    if (!element.initializer) {
      const expression = createPropertyAccessExpression(initializer, propertyName, element.name);
      bindings.set(element.name.text, expression);
      bindingEntries.push({
        localName: element.name.text,
        declaration: element.name,
        expression,
      });
    }

    const values = finiteStringValuesByProperty?.get(propertyName);
    if (values) {
      stringSetBindings.set(element.name.text, values);
    }
  }
}

function createPropertyAccessExpression(
  initializer: ts.Identifier,
  propertyName: string,
  anchorNode: ts.Node,
): ts.Expression {
  const expression = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)
    ? ts.factory.createPropertyAccessExpression(initializer, propertyName)
    : ts.factory.createElementAccessExpression(
        initializer,
        ts.factory.createStringLiteral(propertyName),
      );

  return ts.setTextRange(expression, anchorNode);
}
