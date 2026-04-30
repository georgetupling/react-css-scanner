import type { LegacyRenderModelClassExpressionSummaryStore } from "./adapters/legacyRenderModelAdapter.js";
import { fallbackClassExpressionEvaluator } from "./evaluators/fallbackEvaluator.js";
import { cssModuleClassExpressionEvaluator } from "./evaluators/cssModuleEvaluator.js";
import { legacyRenderModelClassExpressionEvaluator } from "./evaluators/legacyRenderModelEvaluator.js";
import { normalizedClassExpressionEvaluator } from "./evaluators/normalizedExpressionEvaluator.js";
import { runtimeDomClassExpressionEvaluator } from "./evaluators/runtimeDomEvaluator.js";
import type { ProjectBindingResolution } from "../symbol-resolution/index.js";
import type {
  SymbolicEvaluatorRegistry,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  SymbolicExpressionEvaluatorResult,
} from "./types.js";

export function createDefaultSymbolicEvaluatorRegistry(input?: {
  legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
  symbolResolution?: ProjectBindingResolution;
}): SymbolicEvaluatorRegistry {
  return createSymbolicEvaluatorRegistry(
    [
      runtimeDomClassExpressionEvaluator,
      ...(input?.symbolResolution ? [cssModuleClassExpressionEvaluator] : []),
      ...(input?.legacyRenderModelSummaryStore ? [legacyRenderModelClassExpressionEvaluator] : []),
      normalizedClassExpressionEvaluator,
      fallbackClassExpressionEvaluator,
    ],
    input,
  );
}

export function createSymbolicEvaluatorRegistry(
  evaluators: SymbolicExpressionEvaluator[],
  context?: {
    legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
    symbolResolution?: ProjectBindingResolution;
  },
): SymbolicEvaluatorRegistry {
  return {
    evaluate(input: SymbolicExpressionEvaluatorInput): SymbolicExpressionEvaluatorResult {
      const evaluatorInput = {
        ...input,
        ...(context?.legacyRenderModelSummaryStore
          ? { legacyRenderModelSummaryStore: context.legacyRenderModelSummaryStore }
          : {}),
        ...(context?.symbolResolution ? { symbolResolution: context.symbolResolution } : {}),
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
  cssModuleClassExpressionEvaluator,
  legacyRenderModelClassExpressionEvaluator,
  normalizedClassExpressionEvaluator,
  runtimeDomClassExpressionEvaluator,
};
