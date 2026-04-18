import ts from "typescript";

import { unwrapExpression } from "./utils.js";

export function isRenderableExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);

  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped) ||
    ts.isCallExpression(unwrapped) ||
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isConditionalExpression(unwrapped) ||
    isArrayMethodRenderableExpression(unwrapped) ||
    isLogicalRenderableExpression(unwrapped) ||
    isNullishRenderExpression(unwrapped)
  );
}

function isLogicalRenderableExpression(
  expression: ts.Expression,
): expression is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  );
}

function isArrayMethodRenderableExpression(
  expression: ts.Expression,
): expression is ts.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    (expression.expression.name.text === "map" || expression.expression.name.text === "find")
  );
}

function isNullishRenderExpression(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    isUndefinedIdentifier(expression) ||
    (ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

function isUndefinedIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === "undefined";
}
