import ts from "typescript";

import type { ClassExpressionSummary } from "../../abstract-values/types.js";
import {
  buildClassExpressionTraces,
  summarizeClassNameExpression,
  toAbstractClassSet,
} from "../../abstract-values/classExpressions.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { toSourceAnchor, unwrapExpression } from "../shared/renderIrUtils.js";
import {
  mergeExpressionBindings,
  resolveBoundExpression,
  resolveHelperCallContext,
} from "../resolution/resolveBindings.js";
import {
  isIntrinsicTagName,
  resolveExactTruthyExpression,
  resolveIntrinsicTagName,
} from "../resolution/resolveExactValues.js";
import type { RenderNode } from "../types.js";

export function buildElementNode(input: {
  tagNameNode: ts.JsxTagNameExpression;
  attributes: ts.JsxAttributes;
  children: readonly ts.JsxChild[];
  context: BuildContext;
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode;
  buildComponentReferenceNode: (
    tagNameNode: ts.JsxTagNameExpression,
    attributes: ts.JsxAttributes,
    children: readonly ts.JsxChild[],
    context: BuildContext,
  ) => RenderNode;
}): RenderNode {
  const {
    tagNameNode,
    attributes,
    children,
    context,
    buildRenderNode,
    buildComponentReferenceNode,
  } = input;
  const resolvedIntrinsicTagName = resolveIntrinsicTagName(tagNameNode, context);
  const tagName = resolvedIntrinsicTagName ?? tagNameNode.getText(context.parsedSourceFile);
  if (!isIntrinsicTagName(tagName)) {
    return buildComponentReferenceNode(tagNameNode, attributes, children, context);
  }

  return {
    kind: "element",
    sourceAnchor: toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath),
    tagName,
    className: summarizeClassAttribute(attributes, context),
    children: buildChildren(children, context, buildRenderNode),
  };
}

export function buildChildren(
  children: readonly ts.JsxChild[],
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
): RenderNode[] {
  const results: RenderNode[] = [];

  for (const child of children) {
    if (ts.isJsxText(child) && child.getText(context.parsedSourceFile).trim() === "") {
      continue;
    }

    results.push(buildRenderNode(child, context));
  }

  return results;
}

function summarizeClassAttribute(
  attributes: ts.JsxAttributes,
  context: BuildContext,
): ClassExpressionSummary | undefined {
  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      !ts.isIdentifier(property.name) ||
      property.name.text !== "className" ||
      !property.initializer
    ) {
      continue;
    }

    const expression = unwrapJsxAttributeInitializer(property.initializer);
    if (!expression) {
      return undefined;
    }

    const summary = summarizeBoundClassNameExpression(expression, context);
    const sourceExpression = summary.sourceExpression ?? expression;
    const sourceFile = sourceExpression.getSourceFile();
    const sourceAnchor = toSourceAnchor(sourceExpression, sourceFile, sourceFile.fileName);
    const sourceText = sourceExpression.getText(sourceFile);

    return {
      sourceAnchor,
      value: summary.value,
      classes: toAbstractClassSet(summary.value, sourceAnchor),
      sourceText,
      traces: buildClassExpressionTraces({
        sourceAnchor,
        sourceText,
        value: summary.value,
      }),
    };
  }

  return undefined;
}

function unwrapJsxAttributeInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer;
  }

  if (
    ts.isJsxElement(initializer) ||
    ts.isJsxSelfClosingElement(initializer) ||
    ts.isJsxFragment(initializer)
  ) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? undefined;
  }

  return undefined;
}

function summarizeBoundClassNameExpression(
  expression: ts.Expression,
  context: BuildContext,
): {
  value: ReturnType<typeof summarizeClassNameExpression>;
  sourceExpression?: ts.Expression;
} {
  const foundExpression = ts.isCallExpression(expression)
    ? resolveExactFoundClassExpression(expression, context)
    : undefined;
  if (foundExpression !== undefined) {
    if (foundExpression === null) {
      return { value: { kind: "string-exact", value: "" }, sourceExpression: expression };
    }

    return summarizeBoundClassNameExpression(foundExpression, context);
  }

  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return summarizeBoundClassNameExpression(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return summarizeBoundClassNameExpression(boundExpression, context);
  }

  if (ts.isConditionalExpression(expression)) {
    const whenTrue = summarizeBoundClassNameExpression(expression.whenTrue, context);
    const whenFalse = summarizeBoundClassNameExpression(expression.whenFalse, context);
    const values = new Set<string>();

    for (const candidate of [whenTrue, whenFalse]) {
      if (candidate.value.kind === "string-exact") {
        values.add(candidate.value.value);
        continue;
      }

      if (candidate.value.kind === "string-set") {
        for (const value of candidate.value.values) {
          values.add(value);
        }
        continue;
      }

      return {
        value: { kind: "unknown", reason: "unsupported-conditional-branch" },
        sourceExpression: expression,
      };
    }

    return {
      value: {
        kind: "string-set",
        values: [...values].sort((left, right) => left.localeCompare(right)),
      },
      sourceExpression: expression,
    };
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return summarizeBoundClassNameExpression(expression.expression, context);
  }

  return {
    value: summarizeClassNameExpression(expression),
    sourceExpression: expression,
  };
}

function resolveExactFoundClassExpression(
  expression: ts.CallExpression,
  context: BuildContext,
): ts.Expression | null | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "find" ||
    expression.arguments.length !== 1
  ) {
    return undefined;
  }

  const sourceElements = resolveExactClassArrayElements(expression.expression.expression, context);
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

function resolveExactClassArrayElements(
  expression: ts.Expression,
  context: BuildContext,
): ts.Expression[] | undefined {
  const helperResolution = ts.isCallExpression(expression)
    ? resolveHelperCallContext(expression, context)
    : undefined;
  if (helperResolution) {
    return resolveExactClassArrayElements(helperResolution.expression, helperResolution.context);
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return resolveExactClassArrayElements(boundExpression, context);
  }

  if (ts.isArrayLiteralExpression(expression)) {
    const elements: ts.Expression[] = [];
    for (const element of expression.elements) {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
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
    return resolveExactClassArrayElements(expression.expression, context);
  }

  return undefined;
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
