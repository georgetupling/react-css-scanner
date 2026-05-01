import type {
  AnalysisTrace,
  UnsupportedClassReferenceAnalysis,
} from "../../static-analysis-engine/index.js";
import { getUnsupportedClassReferences } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unsupportedSyntaxAffectingAnalysisRule: RuleDefinition = {
  id: "unsupported-syntax-affecting-analysis",
  run(context) {
    return runUnsupportedSyntaxAffectingAnalysisRule(context);
  },
};

function runUnsupportedSyntaxAffectingAnalysisRule(context: RuleContext): UnresolvedFinding[] {
  return getUnsupportedClassReferences(context.analysisEvidence)
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
      traces:
        context.includeTraces === false ? [] : buildUnsupportedClassReferenceTraces({ reference }),
      data: {
        rawExpressionText: reference.rawExpressionText,
        reason: reference.reason,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnsupportedClassReferenceTraces(input: {
  reference: UnsupportedClassReferenceAnalysis;
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
