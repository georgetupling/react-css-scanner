import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";

export function isDefinitelyFalsy(expression: ExpressionSyntaxNode): boolean {
  const unwrapped = expression;
  return (
    (unwrapped.expressionKind === "boolean-literal" && !unwrapped.value) ||
    unwrapped.expressionKind === "nullish-literal" ||
    (unwrapped.expressionKind === "numeric-literal" && Number(unwrapped.value) === 0) ||
    (unwrapped.expressionKind === "string-literal" && unwrapped.value.length === 0)
  );
}

export function isDefinitelyTruthy(expression: ExpressionSyntaxNode): boolean {
  const unwrapped = expression;
  return (
    (unwrapped.expressionKind === "boolean-literal" && unwrapped.value) ||
    (unwrapped.expressionKind === "numeric-literal" && Number(unwrapped.value) !== 0) ||
    (unwrapped.expressionKind === "string-literal" && unwrapped.value.length > 0)
  );
}
