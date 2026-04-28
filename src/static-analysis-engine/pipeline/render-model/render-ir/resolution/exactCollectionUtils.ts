import ts from "typescript";

import { resolveDeclaredValueSymbol } from "../collection/shared/indexExpressionBindingsBySymbolId.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { unwrapExpression } from "../shared/renderIrUtils.js";
import {
  mergeExpressionBindings,
  resolveBoundExpression,
  resolveHelperCallContext,
} from "./resolveBindings.js";

const MAX_EXACT_ARRAY_RESOLUTION_DEPTH = 100;

type ExactArrayResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function resolveExactArrayElements(
  expression: ts.Expression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
): ts.Expression[] | undefined {
  return resolveExactArrayElementsInternal(expression, context, resolveExactTruthyExpression, {
    activeExpressions: new Set(),
    depth: 0,
  });
}

function resolveExactArrayElementsInternal(
  expression: ts.Expression,
  context: BuildContext,
  resolveExactTruthyExpression: (
    expression: ts.Expression,
    context: BuildContext,
  ) => boolean | undefined,
  state: ExactArrayResolutionState,
): ts.Expression[] | undefined {
  if (state.depth > MAX_EXACT_ARRAY_RESOLUTION_DEPTH) {
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
      return resolveExactArrayElementsInternal(
        helperResolution.expression,
        helperResolution.context,
        resolveExactTruthyExpression,
        nextExactArrayResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactArrayElementsInternal(
        boundExpression,
        context,
        resolveExactTruthyExpression,
        nextExactArrayResolutionState(state),
      );
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "filter" &&
      expression.arguments.length === 1
    ) {
      const sourceElements = resolveExactArrayElementsInternal(
        expression.expression.expression,
        context,
        resolveExactTruthyExpression,
        nextExactArrayResolutionState(state),
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
      return resolveExactArrayElementsInternal(
        expression.expression,
        context,
        resolveExactTruthyExpression,
        nextExactArrayResolutionState(state),
      );
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
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
  const callbackBindingsBySymbolId = new Map<string, ts.Expression>();
  const [itemParameter, indexParameter] = input.callback.parameters;

  if (itemParameter && ts.isIdentifier(itemParameter.name)) {
    callbackBindings.set(itemParameter.name.text, input.elementExpression);
    const itemSymbol = resolveDeclaredValueSymbol({
      declaration: itemParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (itemSymbol) {
      callbackBindingsBySymbolId.set(itemSymbol.id, input.elementExpression);
    }
  }

  if (indexParameter && ts.isIdentifier(indexParameter.name)) {
    const indexExpression = ts.factory.createNumericLiteral(input.index);
    callbackBindings.set(indexParameter.name.text, indexExpression);
    const indexSymbol = resolveDeclaredValueSymbol({
      declaration: indexParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (indexSymbol) {
      callbackBindingsBySymbolId.set(indexSymbol.id, indexExpression);
    }
  }

  return {
    ...input.context,
    expressionBindings: mergeExpressionBindings(input.context.expressionBindings, callbackBindings),
    expressionBindingsBySymbolId: mergeExpressionBindings(
      input.context.expressionBindingsBySymbolId,
      callbackBindingsBySymbolId,
    ),
    stringSetBindings: input.context.stringSetBindings,
  };
}

function nextExactArrayResolutionState(
  state: ExactArrayResolutionState,
): ExactArrayResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getExpressionResolutionKey(expression: ts.Expression, context: BuildContext): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
