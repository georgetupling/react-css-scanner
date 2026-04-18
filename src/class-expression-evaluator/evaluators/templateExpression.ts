import ts from "typescript";
import type { EvaluationEnvironment, EvaluationHelpers } from "../types.js";

export function evaluateTemplateExpression(
  expression: ts.TemplateExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const result = helpers.emptyEvaluation();

  mergeCompleteStaticSegmentTokens(
    result,
    expression.head.text,
    {
      leftBoundary: true,
      rightBoundary: false,
    },
    expression,
    helpers,
  );

  for (const [index, span] of expression.templateSpans.entries()) {
    const childResult = helpers.evaluateExpression(span.expression, env, depth + 1);
    if (childResult.tokens.length === 0 && childResult.dynamics.length === 0) {
      helpers.mergeInto(result, helpers.dynamicOnly(span.expression, "template-literal", "medium"));
    } else {
      helpers.mergeInto(result, helpers.downgradeTokensToPossible(childResult));
    }

    mergeCompleteStaticSegmentTokens(
      result,
      span.literal.text,
      {
        leftBoundary: false,
        rightBoundary: index === expression.templateSpans.length - 1,
      },
      expression,
      helpers,
    );
  }

  return result;
}

function mergeCompleteStaticSegmentTokens(
  result: ReturnType<EvaluationHelpers["emptyEvaluation"]>,
  text: string,
  boundaries: {
    leftBoundary: boolean;
    rightBoundary: boolean;
  },
  anchorNode: ts.Node,
  helpers: EvaluationHelpers,
): void {
  for (const token of extractCompleteTokens(text, boundaries)) {
    helpers.mergeInto(
      result,
      helpers.tokenResult(
        token,
        "definite",
        anchorNode,
        "expression-evaluated",
        "medium",
        text,
      ),
    );
  }
}

function extractCompleteTokens(
  text: string,
  boundaries: {
    leftBoundary: boolean;
    rightBoundary: boolean;
  },
): string[] {
  const tokens: string[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;

  tokenPattern.lastIndex = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    const hasLeftBoundary = start > 0 || boundaries.leftBoundary;
    const hasRightBoundary = end < text.length || boundaries.rightBoundary;

    if (hasLeftBoundary && hasRightBoundary) {
      tokens.push(token);
    }
  }

  return tokens;
}
