import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import type { RenderNode } from "../types.js";
import {
  createEmptyFragmentNode,
  createRenderExpansionTrace,
  toSourceAnchor,
  unwrapExpression,
} from "../shared/renderIrUtils.js";
import {
  resolveBoundExpression,
  resolveHelperCallContext,
  mergeExpressionBindings,
} from "../resolution/resolveBindings.js";
import { resolveExactTruthyExpression } from "../resolution/resolveExactValues.js";

const MAX_EXACT_ARRAY_RESOLUTION_DEPTH = 100;

type ExactArrayResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function buildArrayRenderNode(input: {
  node: ts.ArrayLiteralExpression;
  context: BuildContext;
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode;
}): RenderNode {
  const children: RenderNode[] = [];

  for (const element of input.node.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    if (ts.isSpreadElement(element)) {
      const sourceAnchor = toSourceAnchor(
        input.node,
        input.context.parsedSourceFile,
        input.context.filePath,
      );
      return {
        kind: "unknown",
        sourceAnchor,
        reason: "unsupported-render-array-spread",
        traces: input.context.includeTraces
          ? [
              createRenderExpansionTrace({
                traceId: "render-expansion:unknown:array-spread",
                summary: "could not expand render array because spread elements are unsupported",
                anchor: sourceAnchor,
                metadata: {
                  reason: "unsupported-render-array-spread",
                },
              }),
            ]
          : [],
      };
    }

    children.push(input.buildRenderNode(element, input.context));
  }

  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(
      input.node,
      input.context.parsedSourceFile,
      input.context.filePath,
    ),
    children,
  };
}

export function tryBuildMappedArrayRenderNode(input: {
  expression: ts.CallExpression;
  context: BuildContext;
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode;
}): RenderNode | undefined {
  if (
    !ts.isPropertyAccessExpression(input.expression.expression) ||
    input.expression.expression.name.text !== "map"
  ) {
    return undefined;
  }

  if (input.expression.arguments.length !== 1) {
    return undefined;
  }

  const callback = unwrapExpression(input.expression.arguments[0]);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return undefined;
  }

  if (!hasSupportedArrayCallbackParameters(callback)) {
    return undefined;
  }

  const callbackBodyExpression = summarizeArrayCallbackBody(callback.body);
  if (!callbackBodyExpression) {
    return undefined;
  }

  const arrayElements = resolveExactArrayElements(
    input.expression.expression.expression,
    input.context,
  );
  if (!arrayElements) {
    const sourceAnchor = toSourceAnchor(
      input.expression,
      input.context.parsedSourceFile,
      input.context.filePath,
    );
    return {
      kind: "repeated-region",
      sourceAnchor,
      template: input.buildRenderNode(callbackBodyExpression, input.context),
      reason: "bounded-unknown-array-map",
      traces: input.context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:repeated-region:array-map",
              summary:
                "lowered array map output to a repeated region because the source array is not exactly known",
              anchor: sourceAnchor,
              metadata: {
                reason: "bounded-unknown-array-map",
              },
            }),
          ]
        : [],
    };
  }

  const children = arrayElements.map((elementExpression, index) =>
    input.buildRenderNode(
      callbackBodyExpression,
      buildArrayCallbackContext({
        context: input.context,
        callback,
        elementExpression,
        index,
      }),
    ),
  );

  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(
      input.expression,
      input.context.parsedSourceFile,
      input.context.filePath,
    ),
    children,
  };
}

export function tryBuildFoundArrayRenderNode(input: {
  expression: ts.CallExpression;
  context: BuildContext;
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode;
}): RenderNode | undefined {
  if (
    !ts.isPropertyAccessExpression(input.expression.expression) ||
    input.expression.expression.name.text !== "find"
  ) {
    return undefined;
  }

  const foundExpression = resolveExactFoundArrayElement(
    input.expression.expression.expression,
    input.expression.arguments,
    input.context,
  );
  if (foundExpression === undefined) {
    return undefined;
  }

  if (foundExpression === null) {
    return createEmptyFragmentNode(input.expression, input.context);
  }

  return input.buildRenderNode(foundExpression, input.context);
}

function resolveExactArrayElements(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactArrayResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
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
      return resolveExactArrayElements(
        helperResolution.expression,
        helperResolution.context,
        nextExactArrayResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpression(expression, context);
    if (boundExpression) {
      return resolveExactArrayElements(
        boundExpression,
        context,
        nextExactArrayResolutionState(state),
      );
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "filter"
    ) {
      const sourceElements = resolveExactArrayElements(
        expression.expression.expression,
        context,
        nextExactArrayResolutionState(state),
      );
      if (!sourceElements || expression.arguments.length !== 1) {
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
        !hasSupportedArrayCallbackParameters(callback)
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
      return resolveExactArrayElements(
        expression.expression,
        context,
        nextExactArrayResolutionState(state),
      );
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

function resolveExactFoundArrayElement(
  sourceExpression: ts.Expression,
  argumentsList: readonly ts.Expression[],
  context: BuildContext,
): ts.Expression | null | undefined {
  const sourceElements = resolveExactArrayElements(sourceExpression, context);
  if (!sourceElements || argumentsList.length !== 1) {
    return undefined;
  }

  const callback = unwrapExpression(argumentsList[0]);
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
    !hasSupportedArrayCallbackParameters(callback)
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

function hasSupportedArrayCallbackParameters(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  return (
    callback.parameters.length <= 2 &&
    callback.parameters.every((parameter) => ts.isIdentifier(parameter.name))
  );
}

function summarizeArrayCallbackBody(body: ts.ConciseBody): ts.Expression | undefined {
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

function buildArrayCallbackContext(input: {
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
