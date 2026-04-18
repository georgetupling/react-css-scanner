import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import { unwrapExpression } from "../shared/renderIrUtils.js";
import {
  buildArrayCallbackContext,
  resolveExactArrayElements,
  summarizeArrayCallbackBody,
} from "./exactCollectionUtils.js";
import { resolveExactComparableValue, resolveExactStringValue } from "./exactScalarValues.js";

export function resolveExactIncludesBoolean(
  expression: ts.CallExpression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
): boolean | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "includes" ||
    expression.arguments.length !== 1
  ) {
    return undefined;
  }

  const searchValue = resolveExactComparableValue(expression.arguments[0], context);
  if (searchValue === undefined) {
    return undefined;
  }

  const sourceString = resolveExactStringValue(expression.expression.expression, context);
  if (sourceString !== undefined) {
    return sourceString.includes(String(searchValue));
  }

  const sourceElements = resolveExactArrayElements(
    expression.expression.expression,
    context,
    resolveExactTruthyExpression,
  );
  if (!sourceElements) {
    return undefined;
  }

  for (const elementExpression of sourceElements) {
    const elementValue = resolveExactComparableValue(elementExpression, context);
    if (elementValue === undefined) {
      return undefined;
    }

    if (Object.is(elementValue, searchValue)) {
      return true;
    }
  }

  return false;
}

export function resolveExactStringPredicateBoolean(
  expression: ts.CallExpression,
  context: BuildContext,
): boolean | undefined {
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.arguments.length !== 1) {
    return undefined;
  }

  const methodName = expression.expression.name.text;
  if (methodName !== "startsWith" && methodName !== "endsWith") {
    return undefined;
  }

  const sourceString = resolveExactStringValue(expression.expression.expression, context);
  const searchValue = resolveExactStringValue(expression.arguments[0], context);
  if (sourceString === undefined || searchValue === undefined) {
    return undefined;
  }

  if (methodName === "startsWith") {
    return sourceString.startsWith(searchValue);
  }

  return sourceString.endsWith(searchValue);
}

export function resolveExactArrayPredicateBoolean(
  expression: ts.CallExpression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
): boolean | undefined {
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.arguments.length !== 1) {
    return undefined;
  }

  const methodName = expression.expression.name.text;
  if (methodName !== "some" && methodName !== "every") {
    return undefined;
  }

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
    if (methodName === "some") {
      for (const elementExpression of sourceElements) {
        const isTruthy = resolveExactTruthyExpression(elementExpression, context);
        if (isTruthy === undefined) {
          return undefined;
        }

        if (isTruthy) {
          return true;
        }
      }

      return false;
    }

    for (const elementExpression of sourceElements) {
      const isTruthy = resolveExactTruthyExpression(elementExpression, context);
      if (isTruthy === undefined) {
        return undefined;
      }

      if (!isTruthy) {
        return false;
      }
    }

    return true;
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

  if (methodName === "some") {
    for (let index = 0; index < sourceElements.length; index += 1) {
      const callbackContext = buildArrayCallbackContext({
        context,
        callback,
        elementExpression: sourceElements[index],
        index,
      });
      const isMatch = resolveExactTruthyExpression(callbackBodyExpression, callbackContext);
      if (isMatch === undefined) {
        return undefined;
      }

      if (isMatch) {
        return true;
      }
    }

    return false;
  }

  for (let index = 0; index < sourceElements.length; index += 1) {
    const callbackContext = buildArrayCallbackContext({
      context,
      callback,
      elementExpression: sourceElements[index],
      index,
    });
    const isMatch = resolveExactTruthyExpression(callbackBodyExpression, callbackContext);
    if (isMatch === undefined) {
      return undefined;
    }

    if (!isMatch) {
      return false;
    }
  }

  return true;
}

export function resolveExactFoundExpression(
  expression: ts.CallExpression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
): ts.Expression | null | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "find" ||
    expression.arguments.length !== 1
  ) {
    return undefined;
  }

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
    for (const elementExpression of sourceElements) {
      const isTruthy = resolveExactTruthyExpression(elementExpression, context);
      if (isTruthy === undefined) {
        return undefined;
      }

      if (isTruthy) {
        return elementExpression;
      }
    }

    return null;
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

  for (let index = 0; index < sourceElements.length; index += 1) {
    const callbackContext = buildArrayCallbackContext({
      context,
      callback,
      elementExpression: sourceElements[index],
      index,
    });
    const isMatch = resolveExactTruthyExpression(callbackBodyExpression, callbackContext);
    if (isMatch === undefined) {
      return undefined;
    }

    if (isMatch) {
      return sourceElements[index];
    }
  }

  return null;
}
