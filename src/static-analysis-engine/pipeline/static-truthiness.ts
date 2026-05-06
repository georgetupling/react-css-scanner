import type { ExpressionSyntaxNode } from "./fact-graph/index.js";

export type StaticTruthinessValue = boolean | "nullish";

export function evaluateStaticTruthiness(input: {
  expression: ExpressionSyntaxNode;
  resolveExpressionById: (expressionId: string) => ExpressionSyntaxNode | undefined;
  resolveIdentifier?: (
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>,
  ) => ExpressionSyntaxNode | undefined;
  maxDepth?: number;
  depth?: number;
  seenExpressionIds?: Set<string>;
}): StaticTruthinessValue | undefined {
  const depth = input.depth ?? 0;
  if (depth > (input.maxDepth ?? 20)) {
    return undefined;
  }

  const seenExpressionIds = input.seenExpressionIds ?? new Set<string>();
  if (seenExpressionIds.has(input.expression.expressionId)) {
    return undefined;
  }

  const nextSeenExpressionIds = new Set(seenExpressionIds);
  nextSeenExpressionIds.add(input.expression.expressionId);

  switch (input.expression.expressionKind) {
    case "boolean-literal":
      return input.expression.value;

    case "nullish-literal":
      return "nullish";

    case "numeric-literal":
      return Number(input.expression.value) !== 0;

    case "string-literal":
      return input.expression.value.length > 0;

    case "array-literal":
    case "object-literal":
      return true;

    case "wrapper": {
      const inner = input.resolveExpressionById(input.expression.innerExpressionId);
      return inner
        ? evaluateStaticTruthiness({
            ...input,
            expression: inner,
            depth: depth + 1,
            seenExpressionIds: nextSeenExpressionIds,
          })
        : undefined;
    }

    case "prefix-unary": {
      if (input.expression.operator !== "!") {
        return undefined;
      }
      const operand = input.resolveExpressionById(input.expression.operandExpressionId);
      const operandValue = operand
        ? evaluateStaticTruthiness({
            ...input,
            expression: operand,
            depth: depth + 1,
            seenExpressionIds: nextSeenExpressionIds,
          })
        : undefined;
      if (operandValue === undefined) {
        return undefined;
      }
      return operandValue === "nullish" ? true : !operandValue;
    }

    case "binary":
      return evaluateStaticBinaryTruthiness({
        ...input,
        expression: input.expression,
        depth,
        seenExpressionIds: nextSeenExpressionIds,
      });

    case "conditional":
      return evaluateStaticConditionalTruthiness({
        ...input,
        expression: input.expression,
        depth,
        seenExpressionIds: nextSeenExpressionIds,
      });

    case "identifier": {
      const resolved = input.resolveIdentifier?.(input.expression);
      return resolved
        ? evaluateStaticTruthiness({
            ...input,
            expression: resolved,
            depth: depth + 1,
            seenExpressionIds: nextSeenExpressionIds,
          })
        : undefined;
    }

    default:
      return undefined;
  }
}

function evaluateStaticBinaryTruthiness(input: {
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "binary" }>;
  resolveExpressionById: (expressionId: string) => ExpressionSyntaxNode | undefined;
  resolveIdentifier?: (
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>,
  ) => ExpressionSyntaxNode | undefined;
  maxDepth?: number;
  depth: number;
  seenExpressionIds: Set<string>;
}): StaticTruthinessValue | undefined {
  const left = input.resolveExpressionById(input.expression.leftExpressionId);
  const right = input.resolveExpressionById(input.expression.rightExpressionId);
  const leftValue = left
    ? evaluateStaticTruthiness({
        ...input,
        expression: left,
        depth: input.depth + 1,
      })
    : undefined;

  if (leftValue === undefined) {
    return undefined;
  }

  if (input.expression.operator === "&&") {
    if (leftValue === false || leftValue === "nullish") {
      return false;
    }
    return right
      ? evaluateStaticTruthiness({
          ...input,
          expression: right,
          depth: input.depth + 1,
        })
      : undefined;
  }

  if (input.expression.operator === "||") {
    if (leftValue === true) {
      return true;
    }
    return right
      ? evaluateStaticTruthiness({
          ...input,
          expression: right,
          depth: input.depth + 1,
        })
      : undefined;
  }

  if (input.expression.operator === "??") {
    if (leftValue !== "nullish") {
      return leftValue;
    }
    return right
      ? evaluateStaticTruthiness({
          ...input,
          expression: right,
          depth: input.depth + 1,
        })
      : undefined;
  }

  return undefined;
}

function evaluateStaticConditionalTruthiness(input: {
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "conditional" }>;
  resolveExpressionById: (expressionId: string) => ExpressionSyntaxNode | undefined;
  resolveIdentifier?: (
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>,
  ) => ExpressionSyntaxNode | undefined;
  maxDepth?: number;
  depth: number;
  seenExpressionIds: Set<string>;
}): StaticTruthinessValue | undefined {
  const condition = input.resolveExpressionById(input.expression.conditionExpressionId);
  const conditionValue = condition
    ? evaluateStaticTruthiness({
        ...input,
        expression: condition,
        depth: input.depth + 1,
      })
    : undefined;
  if (conditionValue === undefined) {
    return undefined;
  }

  const branchExpressionId =
    conditionValue === true
      ? input.expression.whenTrueExpressionId
      : input.expression.whenFalseExpressionId;
  const branch = input.resolveExpressionById(branchExpressionId);
  return branch
    ? evaluateStaticTruthiness({
        ...input,
        expression: branch,
        depth: input.depth + 1,
      })
    : undefined;
}
