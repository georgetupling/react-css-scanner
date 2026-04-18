import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { unwrapExpression } from "../shared/renderIrUtils.js";
import {
  mergeExpressionBindings,
  resolveBoundExpression,
  resolveHelperCallContext,
} from "./resolveBindings.js";

export function resolveExactArrayElements(
  expression: ts.Expression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
): ts.Expression[] | undefined {
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactArrayElements(
      helperResolution.expression,
      helperResolution.context,
      resolveExactTruthyExpression,
    );
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactArrayElements(boundExpression, context, resolveExactTruthyExpression);
  }

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "filter" &&
    expression.arguments.length === 1
  ) {
    const sourceElements = resolveExactArrayElements(
      expression.expression.expression,
      context,
      resolveExactTruthyExpression,
    );
    if (!sourceElements) {
      return undefined;
    }

    const callback = unwrapExpression(expression.arguments[0]);
    if (ts.isIdentifier(callback) && callback.text === "Boolean") {
      const truthyElements: ts.Expression[] = [];
      for (const elementExpression of sourceElements) {
        const isTruthy = resolveExactTruthyExpression(elementExpression, context);
        if (isTruthy === undefined) {
          return undefined;
        }

        if (isTruthy) {
          truthyElements.push(elementExpression);
        }
      }

      return truthyElements;
    }

    if (
      (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
      callback.parameters.length > 2 ||
      callback.parameters.some((parameter) => !ts.isIdentifier(parameter.name))
    ) {
      return undefined;
    }

    const callbackBodyExpression = summarizeArrayCallbackBody(callback.body);
    if (!callbackBodyExpression) {
      return undefined;
    }

    const filteredElements: ts.Expression[] = [];
    for (let index = 0; index < sourceElements.length; index += 1) {
      const callbackContext = buildArrayCallbackContext({
        context,
        callback,
        elementExpression: sourceElements[index],
        index,
      });
      const shouldInclude = resolveExactTruthyExpression(callbackBodyExpression, callbackContext);
      if (shouldInclude === undefined) {
        return undefined;
      }

      if (shouldInclude) {
        filteredElements.push(sourceElements[index]);
      }
    }

    return filteredElements;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    const elements: ts.Expression[] = [];
    for (const element of expression.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      if (ts.isSpreadElement(element)) {
        return undefined;
      }

      elements.push(element);
    }

    return elements;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return resolveExactArrayElements(expression.expression, context, resolveExactTruthyExpression);
  }

  return undefined;
}

export function summarizeArrayCallbackBody(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) {
    return body;
  }

  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }

  return undefined;
}

export function buildArrayCallbackContext(input: {
  context: BuildContext;
  callback: ts.ArrowFunction | ts.FunctionExpression;
  elementExpression: ts.Expression;
  index: number;
}): BuildContext {
  const callbackBindings = new Map<string, ts.Expression>();
  const [itemParameter, indexParameter] = input.callback.parameters;

  if (itemParameter && ts.isIdentifier(itemParameter.name)) {
    callbackBindings.set(itemParameter.name.text, input.elementExpression);
  }

  if (indexParameter && ts.isIdentifier(indexParameter.name)) {
    callbackBindings.set(indexParameter.name.text, ts.factory.createNumericLiteral(input.index));
  }

  return {
    ...input.context,
    expressionBindings: mergeExpressionBindings(input.context.expressionBindings, callbackBindings),
  };
}
