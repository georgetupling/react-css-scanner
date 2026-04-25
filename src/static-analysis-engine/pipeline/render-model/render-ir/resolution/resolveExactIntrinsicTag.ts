import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { resolveBoundExpression, resolveHelperCallContext } from "./resolveBindings.js";

const MAX_INTRINSIC_TAG_RESOLUTION_DEPTH = 100;

type IntrinsicTagResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function resolveIntrinsicTagName(
  tagNameNode: ts.JsxTagNameExpression,
  context: BuildContext,
): string | undefined {
  if (!ts.isIdentifier(tagNameNode)) {
    return undefined;
  }

  const boundExpression = resolveBoundExpression(tagNameNode, context);
  if (!boundExpression) {
    return undefined;
  }

  return resolveExactIntrinsicTagNameExpression(boundExpression, context);
}

export function resolveExactIntrinsicTagNameExpression(
  expression: ts.Expression,
  context: BuildContext,
): string | undefined {
  return resolveExactIntrinsicTagNameExpressionInternal(expression, context, {
    activeExpressions: new Set(),
    depth: 0,
  });
}

function resolveExactIntrinsicTagNameExpressionInternal(
  expression: ts.Expression,
  context: BuildContext,
  state: IntrinsicTagResolutionState,
): string | undefined {
  if (state.depth > MAX_INTRINSIC_TAG_RESOLUTION_DEPTH) {
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
      return resolveExactIntrinsicTagNameExpressionInternal(
        helperResolution.expression,
        helperResolution.context,
        nextIntrinsicTagState(state),
      );
    }

    const reboundExpression = resolveBoundExpression(expression, context);
    if (reboundExpression) {
      return resolveExactIntrinsicTagNameExpressionInternal(
        reboundExpression,
        context,
        nextIntrinsicTagState(state),
      );
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return isIntrinsicTagName(expression.text) ? expression.text : undefined;
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return resolveExactIntrinsicTagNameExpressionInternal(
        expression.expression,
        context,
        nextIntrinsicTagState(state),
      );
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

export function isIntrinsicTagName(tagName: string): boolean {
  if (tagName.includes(".")) {
    return false;
  }

  const firstCharacter = tagName[0];
  return firstCharacter === firstCharacter.toLowerCase();
}

function nextIntrinsicTagState(state: IntrinsicTagResolutionState): IntrinsicTagResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getExpressionResolutionKey(expression: ts.Expression, context: BuildContext): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
