import ts from "typescript";

import type { ComponentLikeDefinition } from "./types.js";
import { getRenderableRootExpression } from "./isRenderableComponentBody.js";
import { isExported, toSourceAnchor, unwrapExpression } from "./reactComponentAstUtils.js";

export function detectReactWrapperComponent(input: {
  localName: string;
  initializer: ts.Expression;
  statement: ts.VariableStatement;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
  knownComponentNames: ReadonlySet<string>;
}): ComponentLikeDefinition | undefined {
  const wrapperCall = getReactComponentWrapperCall(input.initializer);
  if (!wrapperCall) {
    return undefined;
  }

  const wrappedExpression = unwrapExpression(wrapperCall.arguments[0]);
  const functionLikeNode = getFunctionLikeNode(wrappedExpression);
  if (functionLikeNode && getRenderableRootExpression(functionLikeNode.body)) {
    return {
      componentName: input.localName,
      exported: isExported(input.statement),
      filePath: input.filePath,
      sourceAnchor: toSourceAnchor(wrapperCall, input.parsedSourceFile, input.filePath),
      evidence: "react-wrapper-inline",
      declarationKind: "variable",
      functionLikeNode,
    };
  }

  if (ts.isIdentifier(wrappedExpression) && input.knownComponentNames.has(wrappedExpression.text)) {
    return {
      componentName: input.localName,
      exported: isExported(input.statement),
      filePath: input.filePath,
      sourceAnchor: toSourceAnchor(wrapperCall, input.parsedSourceFile, input.filePath),
      evidence: "react-wrapper-reference",
      declarationKind: "variable",
      referencedComponentName: wrappedExpression.text,
    };
  }

  return undefined;
}

function getFunctionLikeNode(
  expression: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
    ? unwrapped
    : undefined;
}

function getReactComponentWrapperCall(expression: ts.Expression): ts.CallExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length === 0) {
    return undefined;
  }

  return isReactComponentWrapperName(unwrapped.expression) ? unwrapped : undefined;
}

function isReactComponentWrapperName(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "memo" || expression.text === "forwardRef";
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "React" &&
    (expression.name.text === "memo" || expression.name.text === "forwardRef")
  );
}
