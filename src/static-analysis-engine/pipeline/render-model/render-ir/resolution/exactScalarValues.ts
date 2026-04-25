import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { resolveBoundExpression, resolveHelperCallContext } from "./resolveBindings.js";

const MAX_EXACT_SCALAR_RESOLUTION_DEPTH = 100;

type ExactScalarResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function resolveExactComparableValue(
  expression: ts.Expression,
  context: BuildContext,
): string | number | boolean | null | undefined {
  return resolveExactComparableValueInternal(expression, context, {
    activeExpressions: new Set(),
    depth: 0,
  });
}

function resolveExactComparableValueInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactScalarResolutionState,
): string | number | boolean | null | undefined {
  if (state.depth > MAX_EXACT_SCALAR_RESOLUTION_DEPTH) {
    return undefined;
  }

  const expressionKey = getExpressionResolutionKey(expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return undefined;
  }

  state.activeExpressions.add(expressionKey);
  try {
    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return resolveExactComparableValueInternal(
        helperResolution.expression,
        helperResolution.context,
        nextExactScalarState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactComparableValueInternal(
        boundExpression,
        context,
        nextExactScalarState(state),
      );
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
      return resolveExactComparableValueInternal(
        expression.expression,
        context,
        nextExactScalarState(state),
      );
    }

    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      return -Number(expression.operand.text);
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

export function resolveExactStringValue(
  expression: ts.Expression,
  context: BuildContext,
): string | undefined {
  const exactValue = resolveExactComparableValue(expression, context);
  return typeof exactValue === "string" ? exactValue : undefined;
}

function nextExactScalarState(state: ExactScalarResolutionState): ExactScalarResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getExpressionResolutionKey(expression: ts.Expression, context: BuildContext): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
