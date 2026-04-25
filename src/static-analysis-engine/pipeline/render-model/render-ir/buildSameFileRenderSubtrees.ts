import ts from "typescript";
import { buildComponentReferenceNode } from "./builders/buildComponentReferenceNode.js";
import { buildElementNode, buildChildren } from "./builders/buildIntrinsicNode.js";
import { buildLogicalRenderNode } from "./builders/buildLogicalNode.js";
import {
  buildArrayRenderNode,
  tryBuildFoundArrayRenderNode,
  tryBuildMappedArrayRenderNode,
} from "./builders/buildArrayNodes.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import type { BuildContext } from "./shared/internalTypes.js";
import {
  applyPlacementAnchor,
  createEmptyFragmentNode,
  createRenderExpansionTrace,
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
  componentDefinitions?: import("./collection/shared/types.js").SameFileComponentDefinition[];
  componentsByFilePath?: Map<
    string,
    Map<string, import("./collection/shared/types.js").SameFileComponentDefinition>
  >;
  importedExpressionBindings?: Map<string, ts.Expression>;
  importedHelperDefinitions?: Map<
    string,
    import("./collection/shared/types.js").LocalHelperDefinition
  >;
  importedNamespaceExpressionBindings?: Map<string, Map<string, ts.Expression>>;
  importedNamespaceHelperDefinitions?: Map<
    string,
    Map<string, import("./collection/shared/types.js").LocalHelperDefinition>
  >;
  importedNamespaceComponentDefinitions?: Map<
    string,
    Map<string, import("./collection/shared/types.js").SameFileComponentDefinition>
  >;
}): RenderSubtree[] {
  const componentDefinitions = input.componentDefinitions ?? collectSameFileComponents(input);
  const localComponentsByName = new Map(
    componentDefinitions.map((definition) => [definition.componentName, definition]),
  );
  const componentsByFilePath =
    input.componentsByFilePath ?? new Map([[input.filePath, localComponentsByName]]);

  return componentDefinitions.map((definition) => ({
    root: buildRenderNode(definition.rootExpression, {
      filePath: definition.filePath,
      parsedSourceFile: definition.parsedSourceFile,
      currentComponentFilePath: definition.filePath,
      componentsByFilePath,
      currentDepth: 0,
      expansionStack: [definition.componentName],
      expressionBindings: new Map([
        ...(input.importedExpressionBindings?.entries() ?? []),
        ...definition.localExpressionBindings.entries(),
      ]),
      helperDefinitions: new Map([
        ...(input.importedHelperDefinitions?.entries() ?? []),
        ...definition.localHelperDefinitions.entries(),
      ]),
      namespaceExpressionBindings: new Map(
        input.importedNamespaceExpressionBindings?.entries() ?? [],
      ),
      namespaceHelperDefinitions: new Map(
        input.importedNamespaceHelperDefinitions?.entries() ?? [],
      ),
      namespaceComponentDefinitions: new Map(
        input.importedNamespaceComponentDefinitions?.entries() ?? [],
      ),
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
      return applyPlacementAnchor(
        buildRenderNode(node.whenTrue, context),
        toSourceAnchor(node.whenTrue, context.parsedSourceFile, context.filePath),
      );
    }

    if (resolvedCondition === false) {
      return applyPlacementAnchor(
        buildRenderNode(node.whenFalse, context),
        toSourceAnchor(node.whenFalse, context.parsedSourceFile, context.filePath),
      );
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
      const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
      return {
        kind: "unknown",
        sourceAnchor,
        reason: "empty-jsx-expression",
        traces: [
          createRenderExpansionTrace({
            traceId: "render-expansion:unknown:empty-jsx-expression",
            summary: "encountered an empty JSX expression while building render IR",
            anchor: sourceAnchor,
            metadata: {
              reason: "empty-jsx-expression",
            },
          }),
        ],
      };
    }

    const insertedSubtree = tryResolveInsertedSubtreeExpression(node.expression, context, node);
    if (insertedSubtree) {
      return insertedSubtree;
    }

    return buildRenderNode(node.expression, context);
  }

  if (ts.isJsxText(node)) {
    const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
    return {
      kind: "unknown",
      sourceAnchor,
      reason: "jsx-text",
      traces: [
        createRenderExpansionTrace({
          traceId: "render-expansion:unknown:jsx-text",
          summary: "preserved JSX text as an unknown render node in the current bounded IR",
          anchor: sourceAnchor,
          metadata: {
            reason: "jsx-text",
          },
        }),
      ],
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
      return applyPlacementAnchor(
        buildRenderNode(helperResolution.expression, helperResolution.context),
        toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      );
    }

    const helperFailureReason = getHelperCallResolutionFailureReason(node, context);
    if (helperFailureReason) {
      const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
      return {
        kind: "unknown",
        sourceAnchor,
        reason: helperFailureReason,
        traces: [
          createRenderExpansionTrace({
            traceId: "render-expansion:unknown:helper-call",
            summary:
              "could not inline helper-driven render output under the current bounded expansion rules",
            anchor: sourceAnchor,
            metadata: {
              reason: helperFailureReason,
            },
          }),
        ],
      };
    }
  }

  const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
  return {
    kind: "unknown",
    sourceAnchor,
    reason: `unsupported-render-node:${ts.SyntaxKind[node.kind]}`,
    traces: [
      createRenderExpansionTrace({
        traceId: "render-expansion:unknown:unsupported-node",
        summary:
          "encountered a render expression shape that is unsupported in the current bounded IR",
        anchor: sourceAnchor,
        metadata: {
          reason: `unsupported-render-node:${ts.SyntaxKind[node.kind]}`,
        },
      }),
    ],
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
