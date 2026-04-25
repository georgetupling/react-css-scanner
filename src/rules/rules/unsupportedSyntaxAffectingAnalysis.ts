import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unsupportedSyntaxAffectingAnalysisRule: RuleDefinition = {
  id: "unsupported-syntax-affecting-analysis",
  run(context) {
    return runUnsupportedSyntaxAffectingAnalysisRule(context);
  },
};

function runUnsupportedSyntaxAffectingAnalysisRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysis.entities.unsupportedClassReferences
    .map((reference) => ({
      id: `unsupported-syntax-affecting-analysis:${reference.id}`,
      ruleId: "unsupported-syntax-affecting-analysis" as const,
      confidence: "high" as const,
      message:
        "A raw JSX className attribute was skipped because it was not represented in the render IR.",
      subject: {
        kind: "unsupported-class-reference" as const,
        id: reference.id,
      },
      location: reference.location,
      evidence: [
        {
          kind: "source-file" as const,
          id: reference.sourceFileId,
        },
      ],
      traces: buildUnsupportedClassReferenceTraces({ reference }),
      data: {
        rawExpressionText: reference.rawExpressionText,
        reason: reference.reason,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnsupportedClassReferenceTraces(input: {
  reference: RuleContext["analysis"]["entities"]["unsupportedClassReferences"][number];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:unsupported-syntax-affecting-analysis:${input.reference.id}`,
      category: "rule-evaluation",
      summary:
        "unsupported class reference evidence was surfaced as a diagnostic instead of being used by correctness rules",
      anchor: input.reference.location,
      children: input.reference.traces,
      metadata: {
        ruleId: "unsupported-syntax-affecting-analysis",
        referenceId: input.reference.id,
        sourceFileId: input.reference.sourceFileId,
        rawExpressionText: input.reference.rawExpressionText,
        reason: input.reference.reason,
      },
    },
  ];
}
