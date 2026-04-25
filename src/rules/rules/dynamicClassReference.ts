import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const dynamicClassReferenceRule: RuleDefinition = {
  id: "dynamic-class-reference",
  run(context) {
    return runDynamicClassReferenceRule(context);
  },
};

function runDynamicClassReferenceRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysis.entities.classReferences
    .filter((reference) => reference.unknownDynamic)
    .map((reference) => ({
      id: `dynamic-class-reference:${reference.id}`,
      ruleId: "dynamic-class-reference" as const,
      confidence: "high" as const,
      message: "Class reference could not be reduced to a finite set of known class names.",
      subject: {
        kind: "class-reference" as const,
        id: reference.id,
      },
      location: reference.location,
      evidence: [
        {
          kind: "source-file" as const,
          id: reference.sourceFileId,
        },
      ],
      traces: buildDynamicClassReferenceTraces({ reference }),
      data: {
        rawExpressionText: reference.rawExpressionText,
        expressionKind: reference.expressionKind,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildDynamicClassReferenceTraces(input: {
  reference: RuleContext["analysis"]["entities"]["classReferences"][number];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:dynamic-class-reference:${input.reference.id}`,
      category: "rule-evaluation",
      summary: "class reference remained dynamic after class expression evaluation",
      anchor: input.reference.location,
      children: input.reference.traces,
      metadata: {
        ruleId: "dynamic-class-reference",
        referenceId: input.reference.id,
        sourceFileId: input.reference.sourceFileId,
        rawExpressionText: input.reference.rawExpressionText,
        expressionKind: input.reference.expressionKind,
      },
    },
  ];
}
