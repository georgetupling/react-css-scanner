import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";

export function getLocalBindingExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number],
): ExpressionSyntaxNode[] {
  return [binding.expressionId, binding.initializerExpressionId, binding.objectExpressionId]
    .filter((expressionId): expressionId is string => Boolean(expressionId))
    .map((expressionId) => getExpressionSyntax(input, expressionId))
    .filter((expression): expression is ExpressionSyntaxNode => Boolean(expression));
}

export function collectChildExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  expression: ExpressionSyntaxNode,
): ExpressionSyntaxNode[] {
  const ids: string[] = [];
  switch (expression.expressionKind) {
    case "wrapper":
      ids.push(expression.innerExpressionId);
      break;
    case "binary":
      ids.push(expression.leftExpressionId, expression.rightExpressionId);
      break;
    case "conditional":
      ids.push(
        expression.conditionExpressionId,
        expression.whenTrueExpressionId,
        expression.whenFalseExpressionId,
      );
      break;
    case "call":
      ids.push(expression.calleeExpressionId, ...expression.argumentExpressionIds);
      break;
    case "array-literal":
      ids.push(...expression.elementExpressionIds);
      break;
    case "object-literal":
      ids.push(
        ...expression.properties
          .map((property) => property.valueExpressionId)
          .filter((expressionId): expressionId is string => Boolean(expressionId)),
      );
      break;
    case "member-access":
      ids.push(expression.objectExpressionId);
      break;
    case "element-access":
      ids.push(expression.objectExpressionId);
      if (expression.argumentExpressionId) {
        ids.push(expression.argumentExpressionId);
      }
      break;
    case "template-literal":
      ids.push(...expression.spans.map((span) => span.expressionId));
      break;
    case "function":
      ids.push(...expression.returnExpressionIds);
      break;
    case "prefix-unary":
      ids.push(expression.operandExpressionId);
      break;
    default:
      break;
  }
  return ids
    .map((expressionId) => getExpressionSyntax(input, expressionId))
    .filter((child): child is ExpressionSyntaxNode => Boolean(child));
}
