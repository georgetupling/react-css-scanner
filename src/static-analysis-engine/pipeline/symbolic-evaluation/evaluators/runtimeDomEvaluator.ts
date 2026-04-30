import { buildCanonicalClassExpressionFromValue, buildConditions } from "./legacyAstEvaluator.js";
import type { SymbolicExpressionEvaluator } from "../types.js";

export const runtimeDomClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "runtime-dom-class-expression",
  canEvaluate: (input) =>
    input.classExpressionSite.classExpressionSiteKind === "runtime-dom-class" &&
    Boolean(input.classExpressionSite.runtimeDomClassText),
  evaluate(input) {
    const value = {
      kind: "string-exact" as const,
      value: input.classExpressionSite.runtimeDomClassText ?? "",
    };
    const expression = buildCanonicalClassExpressionFromValue({
      input,
      value,
      rawExpressionText: input.classExpressionSite.rawExpressionText,
      provenanceSummary: "Evaluated runtime DOM class text",
    });

    return {
      expression,
      conditions: buildConditions(expression.id, value),
    };
  },
};
