import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { resolveBoundExpression, resolveHelperCallContext } from "./resolveBindings.js";

export function resolveExactComparableValue(
  expression: ts.Expression,
  context: BuildContext,
): string | number | boolean | null | undefined {
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactComparableValue(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactComparableValue(boundExpression, context);
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactComparableValue(expression.expression, context);
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }

  return undefined;
}

export function resolveExactStringValue(
  expression: ts.Expression,
  context: BuildContext,
): string | undefined {
  const exactValue = resolveExactComparableValue(expression, context);
  return typeof exactValue === "string" ? exactValue : undefined;
}
