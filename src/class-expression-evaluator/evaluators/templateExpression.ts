import ts from "typescript";
import type { EvaluationEnvironment, EvaluationHelpers } from "../types.js";

export function evaluateTemplateExpression(
  expression: ts.TemplateExpression,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const result = helpers.emptyEvaluation();

  helpers.mergeInto(
    result,
    helpers.tokensFromString(expression.head.text, expression, "expression-evaluated", "medium"),
  );

  for (const span of expression.templateSpans) {
    const childResult = helpers.evaluateExpression(span.expression, env, depth + 1);
    helpers.mergeInto(result, helpers.downgradeTokensToPossible(childResult));
    helpers.mergeInto(
      result,
      helpers.tokensFromString(span.literal.text, expression, "expression-evaluated", "medium"),
    );
  }

  return result;
}
