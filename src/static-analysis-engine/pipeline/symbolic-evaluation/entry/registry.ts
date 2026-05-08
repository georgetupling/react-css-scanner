import { fallbackClassExpressionEvaluator } from "../evaluators/fallback/fallbackEvaluator.js";
import { normalizedClassExpressionEvaluator } from "../evaluators/normalized/normalizedExpressionEvaluator.js";
import { runtimeDomClassExpressionEvaluator } from "../evaluators/runtime-dom/runtimeDomEvaluator.js";
import type {
  SymbolicEvaluatorRegistry,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  SymbolicExpressionEvaluatorResult,
} from "../model/types.js";

export function createDefaultSymbolicEvaluatorRegistry(): SymbolicEvaluatorRegistry {
  return createSymbolicEvaluatorRegistry([
    runtimeDomClassExpressionEvaluator,
    normalizedClassExpressionEvaluator,
    fallbackClassExpressionEvaluator,
  ]);
}

export function createSymbolicEvaluatorRegistry(
  evaluators: SymbolicExpressionEvaluator[],
): SymbolicEvaluatorRegistry {
  return {
    evaluate(input: SymbolicExpressionEvaluatorInput): SymbolicExpressionEvaluatorResult {
      const evaluator = evaluators.find((candidate) => candidate.canEvaluate(input));

      if (!evaluator) {
        return {};
      }

      return evaluator.evaluate(input);
    },
  };
}

export {
  fallbackClassExpressionEvaluator,
  normalizedClassExpressionEvaluator,
  runtimeDomClassExpressionEvaluator,
};
