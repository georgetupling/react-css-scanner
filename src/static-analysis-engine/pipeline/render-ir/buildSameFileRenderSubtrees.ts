import ts from "typescript";
import { buildComponentReferenceNode } from "./builders/buildComponentReferenceNode.js";
import { buildElementNode, buildChildren } from "./builders/buildIntrinsicNode.js";
import { buildLogicalRenderNode } from "./builders/buildLogicalNode.js";
import {
  buildArrayRenderNode,
  tryBuildFoundArrayRenderNode,
  tryBuildMappedArrayRenderNode,
} from "./builders/buildArrayNodes.js";
import { collectSameFileComponents } from "./collection/collectSameFileComponents.js";
import type { BuildContext } from "./shared/internalTypes.js";
import {
  createEmptyFragmentNode,
  isUndefinedIdentifier,
  toSourceAnchor,
} from "./shared/renderIrUtils.js";
import {
  getHelperCallResolutionFailureReason,
  resolveHelperCallContext,
} from "./resolution/resolveBindings.js";
import { resolveExactBooleanExpression } from "./resolution/resolveExactValues.js";
import type { RenderNode, RenderSubtree } from "./types.js";

export function buildSameFileRenderSubtrees(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): RenderSubtree[] {
  const componentDefinitions = collectSameFileComponents(input);
  const componentsByName = new Map(
    componentDefinitions.map((definition) => [definition.componentName, definition]),
  );

  return componentDefinitions.map((definition) => ({
    root: buildRenderNode(definition.rootExpression, {
      ...input,
      componentsByName,
      currentDepth: 0,
      expansionStack: [definition.componentName],
      expressionBindings: new Map(definition.localExpressionBindings),
      helperDefinitions: new Map(definition.localHelperDefinitions),
      helperExpansionStack: [],
      propsObjectProperties: new Map(),
      propsObjectSubtreeProperties: new Map(),
      subtreeBindings: new Map(),
    }),
    exported: definition.exported,
    componentName: definition.componentName,
    sourceAnchor: definition.sourceAnchor,
  }));
}

function buildRenderNode(node: ts.Expression | ts.JsxChild, context: BuildContext): RenderNode {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return buildRenderNode(node.expression, context);
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return buildLogicalRenderNode({ node, context, buildRenderNode });
  }

  if (isNullishRenderExpression(node)) {
    return createEmptyFragmentNode(node, context);
  }

  if (ts.isConditionalExpression(node)) {
    const resolvedCondition = resolveExactBooleanExpression(node.condition, context);
    if (resolvedCondition === true) {
      return buildRenderNode(node.whenTrue, context);
    }

    if (resolvedCondition === false) {
      return buildRenderNode(node.whenFalse, context);
    }

    return {
      kind: "conditional",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      conditionSourceText: node.condition.getText(context.parsedSourceFile),
      whenTrue: buildRenderNode(node.whenTrue, context),
      whenFalse: buildRenderNode(node.whenFalse, context),
    };
  }

  if (ts.isArrayLiteralExpression(node)) {
    return buildArrayRenderNode({ node, context, buildRenderNode });
  }

  if (ts.isJsxElement(node)) {
    return buildElementNode({
      tagNameNode: node.openingElement.tagName,
      attributes: node.openingElement.attributes,
      children: node.children,
      context,
      buildRenderNode,
      buildComponentReferenceNode: (tagNameNode, attributes, children, buildContext) =>
        buildComponentReferenceNode(
          tagNameNode,
          attributes,
          children,
          buildContext,
          buildRenderNode,
        ),
    });
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return buildElementNode({
      tagNameNode: node.tagName,
      attributes: node.attributes,
      children: [],
      context,
      buildRenderNode,
      buildComponentReferenceNode: (tagNameNode, attributes, children, buildContext) =>
        buildComponentReferenceNode(
          tagNameNode,
          attributes,
          children,
          buildContext,
          buildRenderNode,
        ),
    });
  }

  if (ts.isJsxFragment(node)) {
    return {
      kind: "fragment",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      children: buildChildren(node.children, context, buildRenderNode),
    };
  }

  if (ts.isJsxExpression(node)) {
    if (!node.expression) {
      return {
        kind: "unknown",
        sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
        reason: "empty-jsx-expression",
      };
    }

    const insertedSubtree = tryResolveInsertedSubtreeExpression(node.expression, context, node);
    if (insertedSubtree) {
      return insertedSubtree;
    }

    return buildRenderNode(node.expression, context);
  }

  if (ts.isJsxText(node)) {
    return {
      kind: "unknown",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      reason: "jsx-text",
    };
  }

  if (ts.isCallExpression(node)) {
    const foundArrayNode = tryBuildFoundArrayRenderNode({
      expression: node,
      context,
      buildRenderNode,
    });
    if (foundArrayNode) {
      return foundArrayNode;
    }

    const mappedArrayNode = tryBuildMappedArrayRenderNode({
      expression: node,
      context,
      buildRenderNode,
    });
    if (mappedArrayNode) {
      return mappedArrayNode;
    }

    const helperResolution = resolveHelperCallContext(node, context);
    if (helperResolution) {
      return buildRenderNode(helperResolution.expression, helperResolution.context);
    }

    const helperFailureReason = getHelperCallResolutionFailureReason(node, context);
    if (helperFailureReason) {
      return {
        kind: "unknown",
        sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
        reason: helperFailureReason,
      };
    }
  }

  return {
    kind: "unknown",
    sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
    reason: `unsupported-render-node:${ts.SyntaxKind[node.kind]}`,
  };
}

function tryResolveInsertedSubtreeExpression(
  expression: ts.Expression,
  context: BuildContext,
  anchorNode: ts.Node,
): RenderNode | undefined {
  const subtreeNodes = resolveInsertedSubtreeNodes(expression, context);
  if (!subtreeNodes) {
    return undefined;
  }

  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(anchorNode, context.parsedSourceFile, context.filePath),
    children: subtreeNodes,
  };
}

function resolveInsertedSubtreeNodes(
  expression: ts.Expression,
  context: BuildContext,
): RenderNode[] | undefined {
  if (ts.isIdentifier(expression)) {
    return context.subtreeBindings.get(expression.text);
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    context.propsObjectBindingName &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === context.propsObjectBindingName
  ) {
    return context.propsObjectSubtreeProperties.get(expression.name.text);
  }

  return undefined;
}

function isNullishRenderExpression(node: ts.Expression | ts.JsxChild): boolean {
  if (!("kind" in node)) {
    return false;
  }

  return node.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(node);
}
