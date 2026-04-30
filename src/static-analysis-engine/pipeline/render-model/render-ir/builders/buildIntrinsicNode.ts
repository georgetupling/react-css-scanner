import ts from "typescript";

import type { ClassExpressionSummary } from "../../abstract-values/types.js";
import { summarizeClassNameExpressionForRenderModel } from "../../../symbolic-evaluation/adapters/renderModelClassExpressions.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { toSourceAnchor } from "../shared/renderIrUtils.js";
import { isIntrinsicTagName, resolveIntrinsicTagName } from "../resolution/resolveExactValues.js";
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

export function summarizeClassAttribute(
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

    return summarizeClassNameExpressionForRender(expression, context);
  }

  return undefined;
}

export function summarizeClassNameExpressionForRender(
  expression: ts.Expression,
  context: BuildContext,
): ClassExpressionSummary {
  return summarizeClassNameExpressionForRenderModel({ expression, context });
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
