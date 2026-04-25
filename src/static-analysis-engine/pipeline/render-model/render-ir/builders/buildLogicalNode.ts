import ts from "typescript";

import type { BuildContext } from "../shared/internalTypes.js";
import {
  createEmptyFragmentNode,
  createRenderExpansionTrace,
  toSourceAnchor,
} from "../shared/renderIrUtils.js";
import {
  resolveExactNullishExpression,
  resolveExactTruthyExpression,
} from "../resolution/resolveExactValues.js";
import type { RenderNode } from "../types.js";

export function buildLogicalRenderNode(input: {
  node: ts.BinaryExpression;
  context: BuildContext;
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode;
}): RenderNode {
  const { node, context, buildRenderNode } = input;
  const leftTruthy = resolveExactTruthyExpression(node.left, context);

  if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (leftTruthy === true) {
      return buildRenderNode(node.right, context);
    }

    if (leftTruthy === false) {
      return createEmptyFragmentNode(node, context);
    }

    return {
      kind: "conditional",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      conditionSourceText: node.left.getText(context.parsedSourceFile),
      whenTrue: buildRenderNode(node.right, context),
      whenFalse: createEmptyFragmentNode(node.left, context),
    };
  }

  if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    if (leftTruthy === true) {
      return createEmptyFragmentNode(node, context);
    }

    if (leftTruthy === false) {
      return buildRenderNode(node.right, context);
    }

    return {
      kind: "conditional",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      conditionSourceText: node.left.getText(context.parsedSourceFile),
      whenTrue: createEmptyFragmentNode(node.left, context),
      whenFalse: buildRenderNode(node.right, context),
    };
  }

  if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const leftNullish = resolveExactNullishExpression(node.left, context);
    if (leftNullish === false) {
      return buildRenderNode(node.left, context);
    }

    if (leftNullish === true) {
      return buildRenderNode(node.right, context);
    }

    return {
      kind: "conditional",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      conditionSourceText: `${node.left.getText(context.parsedSourceFile)} == null`,
      whenTrue: buildRenderNode(node.right, context),
      whenFalse: buildRenderNode(node.left, context),
    };
  }

  const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
  return {
    kind: "unknown",
    sourceAnchor,
    reason: `unsupported-logical-render-operator:${ts.SyntaxKind[node.operatorToken.kind]}`,
    traces: [
      createRenderExpansionTrace({
        traceId: "render-expansion:unknown:logical-operator",
        summary: "could not expand logical render expression because the operator is unsupported",
        anchor: sourceAnchor,
        metadata: {
          reason: `unsupported-logical-render-operator:${ts.SyntaxKind[node.operatorToken.kind]}`,
        },
      }),
    ],
  };
}
