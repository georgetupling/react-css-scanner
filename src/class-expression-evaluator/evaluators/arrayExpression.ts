import type ts from "typescript";
import type { EvaluationEnvironment, EvaluationHelpers } from "../types.js";

export function evaluateArrayElements(
  elements: readonly ts.Expression[] | ts.NodeArray<ts.Expression>,
  helpers: EvaluationHelpers,
  env: EvaluationEnvironment,
  depth: number,
) {
  const result = helpers.emptyEvaluation();

  for (const element of elements) {
    helpers.mergeInto(result, helpers.evaluateExpression(element, env, depth + 1));
  }

  return result;
}
