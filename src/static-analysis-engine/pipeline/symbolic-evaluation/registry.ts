import type { LegacyAstExpressionStore } from "./adapters/legacyAstExpressionStore.js";
import type { LegacyRenderModelClassExpressionSummaryStore } from "./adapters/legacyRenderModelAdapter.js";
import { fallbackClassExpressionEvaluator } from "./evaluators/fallbackEvaluator.js";
import { cssModuleClassExpressionEvaluator } from "./evaluators/cssModuleEvaluator.js";
import { legacyAstClassExpressionEvaluator } from "./evaluators/legacyAstEvaluator.js";
import { legacyRenderModelClassExpressionEvaluator } from "./evaluators/legacyRenderModelEvaluator.js";
import { runtimeDomClassExpressionEvaluator } from "./evaluators/runtimeDomEvaluator.js";
import type { ProjectBindingResolution } from "../symbol-resolution/index.js";
import type {
  SymbolicEvaluatorRegistry,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  SymbolicExpressionEvaluatorResult,
} from "./types.js";

export function createDefaultSymbolicEvaluatorRegistry(input?: {
  legacyExpressionStore?: LegacyAstExpressionStore;
  legacyRenderModelSummaryStore?: LegacyRenderModelClassExpressionSummaryStore;
  symbolResolution?: ProjectBindingResolution;
}): SymbolicEvaluatorRegistry {
  return createSymbolicEvaluatorRegistry(
    [
      runtimeDomClassExpressionEvaluator,
      ...(input?.symbolResolution ? [cssModuleClassExpressionEvaluator] : []),
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
    symbolResolution?: ProjectBindingResolution;
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
  legacyAstClassExpressionEvaluator,
  legacyRenderModelClassExpressionEvaluator,
  runtimeDomClassExpressionEvaluator,
};
