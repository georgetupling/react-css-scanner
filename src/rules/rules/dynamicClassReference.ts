import type { AnalysisTrace, ClassReferenceAnalysis } from "../../static-analysis-engine/index.js";
import { getClassReferences } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const dynamicClassReferenceRule: RuleDefinition = {
  id: "dynamic-class-reference",
  run(context) {
    return runDynamicClassReferenceRule(context);
  },
};

function runDynamicClassReferenceRule(context: RuleContext): UnresolvedFinding[] {
  const cssModuleReferenceKeys = new Set(
    context.analysisEvidence.projectEvidence.entities.cssModuleMemberReferences.map((reference) =>
      createLocationExpressionKey(reference.location, reference.rawExpressionText),
    ),
  );

  return getClassReferences(context.analysisEvidence)
    .filter((reference) => reference.unknownDynamic)
    .filter(
      (reference) =>
        !cssModuleReferenceKeys.has(
          createLocationExpressionKey(reference.location, reference.rawExpressionText),
        ),
    )
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
      traces:
        context.includeTraces === false ? [] : buildDynamicClassReferenceTraces({ reference }),
      data: {
        rawExpressionText: reference.rawExpressionText,
        expressionKind: reference.expressionKind,
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createLocationExpressionKey(
  location: ClassReferenceAnalysis["location"],
  rawExpressionText: string,
): string {
  return [
    location.filePath,
    location.startLine,
    location.startColumn,
    location.endLine ?? "",
    location.endColumn ?? "",
    rawExpressionText,
  ].join(":");
}

function buildDynamicClassReferenceTraces(input: {
  reference: ClassReferenceAnalysis;
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
