import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { resolveBoundExpression, resolveHelperCallContext } from "./resolveBindings.js";

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
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactIntrinsicTagNameExpression(
      helperResolution.expression,
      helperResolution.context,
    );
  }

  const reboundExpression = resolveBoundExpression(expression, context);
  if (reboundExpression) {
    return resolveExactIntrinsicTagNameExpression(reboundExpression, context);
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return isIntrinsicTagName(expression.text) ? expression.text : undefined;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactIntrinsicTagNameExpression(expression.expression, context);
  }

  return undefined;
}

export function isIntrinsicTagName(tagName: string): boolean {
  if (tagName.includes(".")) {
    return false;
  }

  const firstCharacter = tagName[0];
  return firstCharacter === firstCharacter.toLowerCase();
}
