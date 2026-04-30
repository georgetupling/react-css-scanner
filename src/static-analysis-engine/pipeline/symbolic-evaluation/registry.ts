import type { LegacyAstExpressionStore } from "./adapters/legacyAstExpressionStore.js";
import type { LegacyRenderModelClassExpressionSummaryStore } from "./adapters/legacyRenderModelAdapter.js";
import { fallbackClassExpressionEvaluator } from "./evaluators/fallbackEvaluator.js";
import { legacyAstClassExpressionEvaluator } from "./evaluators/legacyAstEvaluator.js";
import { legacyRenderModelClassExpressionEvaluator } from "./evaluators/legacyRenderModelEvaluator.js";
import type {
  SymbolicEvaluatorRegistry,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  SymbolicExpressionEvaluatorResult,
} from "./types.js";

export function createDefaultSymbolicEvaluatorRegistry(input?: {
  legacyExpressionStore?: LegacyAstExpressionStore;
  legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
}): SymbolicEvaluatorRegistry {
  return createSymbolicEvaluatorRegistry(
    [
      ...(input?.legacyRenderModelSummaryStore ? [legacyRenderModelClassExpressionEvaluator] : []),
      ...(input?.legacyExpressionStore ? [legacyAstClassExpressionEvaluator] : []),
      fallbackClassExpressionEvaluator,
    ],
    input,
  );
}

export function createSymbolicEvaluatorRegistry(
  evaluators: SymbolicExpressionEvaluator[],
  context?: {
    legacyExpressionStore?: LegacyAstExpressionStore;
    legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
  },
): SymbolicEvaluatorRegistry {
  return {
    evaluate(input: SymbolicExpressionEvaluatorInput): SymbolicExpressionEvaluatorResult {
      const evaluatorInput = {
        ...input,
        ...(context?.legacyExpressionStore
          ? { legacyExpressionStore: context.legacyExpressionStore }
          : {}),
        ...(context?.legacyRenderModelSummaryStore
          ? { legacyRenderModelSummaryStore: context.legacyRenderModelSummaryStore }
          : {}),
      };
      const evaluator = evaluators.find((candidate) => candidate.canEvaluate(evaluatorInput));

      if (!evaluator) {
        return {};
      }

      return evaluator.evaluate(evaluatorInput);
    },
  };
}

export {
  fallbackClassExpressionEvaluator,
  legacyAstClassExpressionEvaluator,
  legacyRenderModelClassExpressionEvaluator,
};
