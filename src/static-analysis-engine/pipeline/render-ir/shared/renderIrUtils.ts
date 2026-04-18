import ts from "typescript";

import type { SourceAnchor } from "../../types/core.js";
import type { BuildContext } from "./internalTypes.js";
import type { RenderNode } from "../types.js";

export function createEmptyFragmentNode(node: ts.Node, context: BuildContext): RenderNode {
  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
    children: [],
  };
}

export function isUndefinedIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === "undefined";
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

export function toSourceAnchor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}
