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

const MAX_EXACT_BOOLEAN_RESOLUTION_DEPTH = 100;

type ExactBooleanResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function resolveExactBooleanExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  return resolveExactBooleanExpressionInternal(expression, context, createExactBooleanState());
}

function resolveExactBooleanExpressionInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): boolean | undefined {
  if (!enterResolution("boolean", expression, context, state)) {
    return undefined;
  }

  try {
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
      return resolveExactBooleanExpressionInternal(
        helperResolution.expression,
        helperResolution.context,
        nextExactBooleanState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactBooleanExpressionInternal(
        boundExpression,
        context,
        nextExactBooleanState(state),
      );
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
      return resolveExactBooleanExpressionInternal(
        expression.expression,
        context,
        nextExactBooleanState(state),
      );
    }

    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const operand = resolveExactBooleanExpressionInternal(
        expression.operand,
        context,
        nextExactBooleanState(state),
      );
      return operand === undefined ? undefined : !operand;
    }

    return undefined;
  } finally {
    exitResolution("boolean", expression, context, state);
  }
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
  return isExplicitNullishOperandInternal(expression, context, createExactBooleanState());
}

function isExplicitNullishOperandInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): boolean {
  if (!enterResolution("explicit-nullish", expression, context, state)) {
    return false;
  }

  try {
    if (expression.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(expression)) {
      return true;
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return isExplicitNullishOperandInternal(
        expression.expression,
        context,
        nextExactBooleanState(state),
      );
    }

    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return isExplicitNullishOperandInternal(
        helperResolution.expression,
        helperResolution.context,
        nextExactBooleanState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return isExplicitNullishOperandInternal(
        boundExpression,
        context,
        nextExactBooleanState(state),
      );
    }

    return false;
  } finally {
    exitResolution("explicit-nullish", expression, context, state);
  }
}

export function resolveExactNullishExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  return resolveExactNullishExpressionInternal(expression, context, createExactBooleanState());
}

function resolveExactNullishExpressionInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): boolean | undefined {
  if (!enterResolution("nullish", expression, context, state)) {
    return undefined;
  }

  try {
    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return resolveExactNullishExpressionInternal(
        helperResolution.expression,
        helperResolution.context,
        nextExactBooleanState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactNullishExpressionInternal(
        boundExpression,
        context,
        nextExactBooleanState(state),
      );
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
      return resolveExactNullishExpressionInternal(
        expression.expression,
        context,
        nextExactBooleanState(state),
      );
    }

    return undefined;
  } finally {
    exitResolution("nullish", expression, context, state);
  }
}

export function resolveExactTruthyExpression(
  expression: ts.Expression,
  context: BuildContext,
): boolean | undefined {
  return resolveExactTruthyExpressionInternal(expression, context, createExactBooleanState());
}

function resolveExactTruthyExpressionInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): boolean | undefined {
  if (!enterResolution("truthy", expression, context, state)) {
    return undefined;
  }

  try {
    const exactBoolean = resolveExactBooleanExpressionInternal(
      expression,
      context,
      nextExactBooleanState(state),
    );
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

      return resolveExactTruthyExpressionInternal(
        exactFoundExpression,
        context,
        nextExactBooleanState(state),
      );
    }

    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return resolveExactTruthyExpressionInternal(
        helperResolution.expression,
        helperResolution.context,
        nextExactBooleanState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactTruthyExpressionInternal(
        boundExpression,
        context,
        nextExactBooleanState(state),
      );
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
      return resolveExactTruthyExpressionInternal(
        expression.expression,
        context,
        nextExactBooleanState(state),
      );
    }

    if (ts.isPrefixUnaryExpression(expression)) {
      if (expression.operator === ts.SyntaxKind.ExclamationToken) {
        const operand = resolveExactTruthyExpressionInternal(
          expression.operand,
          context,
          nextExactBooleanState(state),
        );
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
  } finally {
    exitResolution("truthy", expression, context, state);
  }
}

function createExactBooleanState(): ExactBooleanResolutionState {
  return {
    activeExpressions: new Set(),
    depth: 0,
  };
}

function nextExactBooleanState(state: ExactBooleanResolutionState): ExactBooleanResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function enterResolution(
  kind: string,
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): boolean {
  if (state.depth > MAX_EXACT_BOOLEAN_RESOLUTION_DEPTH) {
    return false;
  }

  const expressionKey = getExpressionResolutionKey(kind, expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return false;
  }

  state.activeExpressions.add(expressionKey);
  return true;
}

function exitResolution(
  kind: string,
  expression: ts.Expression,
  context: BuildContext,
  state: ExactBooleanResolutionState,
): void {
  state.activeExpressions.delete(getExpressionResolutionKey(kind, expression, context));
}

function getExpressionResolutionKey(
  kind: string,
  expression: ts.Expression,
  context: BuildContext,
): string {
  return `${kind}:${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
