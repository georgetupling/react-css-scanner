import { createExpressionEvaluator } from "./evaluateExpression.js";
import { normalizeEvaluation } from "./resultUtils.js";
import type { ClassExpressionEvaluationContext } from "./types.js";

export { createExpressionEvaluator };
export type {
  ClassExpressionEvaluation,
  ClassExpressionEvaluationContext,
  DynamicEvaluation,
  EvaluationEnvironment,
  LocalFunctionBinding,
  TokenEvaluation,
} from "./types.js";

export function evaluateClassExpression(
  expression: Parameters<ReturnType<typeof createExpressionEvaluator>["evaluateExpression"]>[0],
  context: ClassExpressionEvaluationContext,
) {
  const evaluator = createExpressionEvaluator(context);
  return normalizeEvaluation(evaluator.evaluateExpression(expression, new Map(), 0));
}
