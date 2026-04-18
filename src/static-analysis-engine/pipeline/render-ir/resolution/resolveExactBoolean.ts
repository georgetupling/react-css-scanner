import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { isUndefinedIdentifier } from "../shared/renderIrUtils.js";
import { resolveExactComparableValue } from "./exactScalarValues.js";
import { resolveBoundExpression, resolveHelperCallContext } from "./resolveBindings.js";
import {
  resolveExactArrayPredicateBoolean,
  resolveExactFoundExpression,
  resolveExactIncludesBoolean,
  resolveExactStringPredicateBoolean,
} from "./exactCollectionPredicates.js";

export function resolveExactBooleanExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  const exactStringPredicateBoolean = ts.isCallExpression(expression)
    ? resolveExactStringPredicateBoolean(expression, context)
    : undefined;
  if (exactStringPredicateBoolean !== undefined) {
    return exactStringPredicateBoolean;
  }

  const exactComparisonBoolean = ts.isBinaryExpression(expression)
    ? resolveExactComparisonBoolean(expression, context)
    : undefined;
  if (exactComparisonBoolean !== undefined) {
    return exactComparisonBoolean;
  }

  const exactIncludesBoolean = ts.isCallExpression(expression)
    ? resolveExactIncludesBoolean(expression, context, resolveExactTruthyExpression)
    : undefined;
  if (exactIncludesBoolean !== undefined) {
    return exactIncludesBoolean;
  }

  const exactCollectionBoolean = ts.isCallExpression(expression)
    ? resolveExactArrayPredicateBoolean(expression, context, resolveExactTruthyExpression)
    : undefined;
  if (exactCollectionBoolean !== undefined) {
    return exactCollectionBoolean;
  }

  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactBooleanExpression(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactBooleanExpression(boundExpression, context);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactBooleanExpression(expression.expression, context);
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operand = resolveExactBooleanExpression(expression.operand, context);
    return operand === undefined ? undefined : !operand;
  }

  return undefined;
}

function resolveExactComparisonBoolean(
  expression: ts.BinaryExpression,
  context: BuildContext,
): boolean | undefined {
  const operator = expression.operatorToken.kind;

  if (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    const leftNullish = resolveExactNullishExpression(expression.left, context);
    const rightNullish = resolveExactNullishExpression(expression.right, context);

    if (
      (leftNullish !== undefined &&
        rightNullish !== undefined &&
        isExplicitNullishOperand(expression.left, context)) ||
      (leftNullish !== undefined &&
        rightNullish !== undefined &&
        isExplicitNullishOperand(expression.right, context))
    ) {
      const isEqual = leftNullish === rightNullish;
      return operator === ts.SyntaxKind.EqualsEqualsToken ? isEqual : !isEqual;
    }
  }

  if (
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsToken &&
    operator !== ts.SyntaxKind.GreaterThanToken &&
    operator !== ts.SyntaxKind.GreaterThanEqualsToken &&
    operator !== ts.SyntaxKind.LessThanToken &&
    operator !== ts.SyntaxKind.LessThanEqualsToken
  ) {
    return undefined;
  }

  const leftValue = resolveExactComparableValue(expression.left, context);
  const rightValue = resolveExactComparableValue(expression.right, context);
  if (leftValue === undefined || rightValue === undefined) {
    return undefined;
  }

  if (
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsToken
  ) {
    return leftValue === rightValue;
  }

  if (
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return leftValue !== rightValue;
  }

  if (
    (typeof leftValue !== "number" || typeof rightValue !== "number") &&
    (typeof leftValue !== "string" || typeof rightValue !== "string")
  ) {
    return undefined;
  }

  if (operator === ts.SyntaxKind.GreaterThanToken) {
    return leftValue > rightValue;
  }

  if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
    return leftValue >= rightValue;
  }

  if (operator === ts.SyntaxKind.LessThanToken) {
    return leftValue < rightValue;
  }

  if (operator === ts.SyntaxKind.LessThanEqualsToken) {
    return leftValue <= rightValue;
  }

  return undefined;
}

function isExplicitNullishOperand(expression: ts.Expression, context: BuildContext): boolean {
  if (expression.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(expression)) {
    return true;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return isExplicitNullishOperand(expression.expression, context);
  }

  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return isExplicitNullishOperand(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return isExplicitNullishOperand(boundExpression, context);
  }

  return false;
}

export function resolveExactNullishExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactNullishExpression(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactNullishExpression(boundExpression, context);
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(expression)) {
    return true;
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return false;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactNullishExpression(expression.expression, context);
  }

  return undefined;
}

export function resolveExactTruthyExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  const exactBoolean = resolveExactBooleanExpression(expression, context);
  if (exactBoolean !== undefined) {
    return exactBoolean;
  }

  const exactFoundExpression = ts.isCallExpression(expression)
    ? resolveExactFoundExpression(expression, context, resolveExactTruthyExpression)
    : undefined;
  if (exactFoundExpression !== undefined) {
    if (exactFoundExpression === null) {
      return false;
    }

    return resolveExactTruthyExpression(exactFoundExpression, context);
  }

  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactTruthyExpression(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactTruthyExpression(boundExpression, context);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    isUndefinedIdentifier(expression)
  ) {
    return false;
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.length > 0;
  }

  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text) !== 0;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactTruthyExpression(expression.expression, context);
  }

  if (ts.isPrefixUnaryExpression(expression)) {
    if (expression.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = resolveExactTruthyExpression(expression.operand, context);
      return operand === undefined ? undefined : !operand;
    }

    if (
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      return Number(expression.operand.text) !== 0;
    }
  }

  return undefined;
}
