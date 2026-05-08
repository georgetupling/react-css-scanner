import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { AbstractValue } from "./types.js";

export function buildClassExpressionTraces(input: {
  sourceAnchor: SourceAnchor;
  sourceText: string;
  value: AbstractValue;
  includeTraces?: boolean;
}): AnalysisTrace[] {
  if (input.includeTraces === false) {
    return [];
  }

  return [
    {
      traceId: `value-evaluation:class-expression:${input.sourceAnchor.filePath}:${input.sourceAnchor.startLine}:${input.sourceAnchor.startColumn}`,
      category: "value-evaluation",
      summary: getClassExpressionTraceSummary(input.value),
      anchor: input.sourceAnchor,
      children: [],
      metadata: {
        sourceText: input.sourceText,
        valueKind: input.value.kind,
      },
    },
  ];
}

function getClassExpressionTraceSummary(value: AbstractValue): string {
  if (value.kind === "string-exact") {
    return "className expression evaluated to an exact string";
  }

  if (value.kind === "string-set") {
    return "className expression evaluated to a bounded set of strings";
  }

  if (value.kind === "class-set") {
    if (value.unknownDynamic) {
      return "className expression evaluated to a partial class set with unknown dynamic input";
    }

    return "className expression evaluated to a bounded class set";
  }

  return `className expression could not be fully evaluated: ${value.reason}`;
}
