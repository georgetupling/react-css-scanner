import type { ExpressionSyntaxNode } from "../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../model/types.js";

export function getExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  expressionId: string,
): ExpressionSyntaxNode | undefined {
  const nodeId = input.graph.indexes.expressionSyntaxNodeIdByExpressionId.get(expressionId);
  const indexedNode = nodeId ? input.graph.indexes.nodesById.get(nodeId) : undefined;
  if (indexedNode?.kind === "expression-syntax") {
    return indexedNode;
  }

  return input.graph.nodes.expressionSyntax.find((node) => node.expressionId === expressionId);
}
