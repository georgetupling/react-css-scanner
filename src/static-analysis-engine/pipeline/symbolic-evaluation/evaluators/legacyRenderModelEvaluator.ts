import { classExpressionTextMismatchDiagnostic } from "../diagnostics.js";
import {
  buildCanonicalClassExpressionFromValue,
  buildConditions,
} from "./canonicalClassExpressionBuilder.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { SymbolicEvaluationDiagnostic, SymbolicExpressionEvaluator } from "../types.js";

export const legacyRenderModelClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "legacy-render-model-class-expression",
  canEvaluate: (input) =>
    Boolean(input.legacyRenderModelSummaryStore?.getSummaryForSite(input.classExpressionSite)),
  evaluate(input) {
    const record = input.legacyRenderModelSummaryStore?.getSummaryForSite(
      input.classExpressionSite,
    );
    if (!record) {
      return {};
    }

    const diagnostics: SymbolicEvaluationDiagnostic[] = [];
    if (record.rawExpressionText !== input.classExpressionSite.rawExpressionText) {
      diagnostics.push(
        classExpressionTextMismatchDiagnostic({
          site: input.classExpressionSite,
          graphRawExpressionText: input.classExpressionSite.rawExpressionText,
          adapterRawExpressionText: record.rawExpressionText,
          adapterName: "legacy render-model adapter",
        }),
      );
    }

    const expression = buildCanonicalClassExpressionFromValue({
      input,
      value: record.summary.value,
      rawExpressionText: record.summary.sourceText,
      provenanceSummary: "Evaluated class expression with legacy render-model adapter",
      tokenAnchors: toCanonicalTokenAnchors(record.summary.classNameSourceAnchors),
      traces: record.summary.traces,
    });

    return {
      expression,
      conditions: buildConditions(expression.id, record.summary.value),
      diagnostics,
    };
  },
};

function toCanonicalTokenAnchors(anchors: Record<string, SourceAnchor> | undefined) {
  if (!anchors) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(anchors).map(([token, sourceAnchor]) => [token, [sourceAnchor]]),
  );
}
