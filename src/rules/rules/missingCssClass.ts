import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import type { AnalysisTrace } from "../../static-analysis-engine/index.js";

export const missingCssClassRule: RuleDefinition = {
  id: "missing-css-class",
  run(context) {
    return runMissingCssClassRule(context);
  },
};

function runMissingCssClassRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const reference of context.analysis.entities.classReferences) {
    for (const className of reference.definiteClassNames) {
      if (context.analysis.indexes.definitionsByClassName.has(className)) {
        continue;
      }

      if (
        context.analysis.indexes.providerSatisfactionsByReferenceAndClassName.has(
          createReferenceClassKey(reference.id, className),
        )
      ) {
        continue;
      }

      findings.push({
        id: `missing-css-class:${reference.id}:${className}`,
        ruleId: "missing-css-class",
        confidence: "high",
        message: `Class "${className}" is referenced but no matching CSS definition or declared provider was found.`,
        subject: {
          kind: "class-reference",
          id: reference.id,
        },
        location: reference.location,
        evidence: [
          {
            kind: "source-file",
            id: reference.sourceFileId,
          },
        ],
        traces: buildMissingClassTraces({
          reference,
          className,
        }),
        data: {
          className,
          rawExpressionText: reference.rawExpressionText,
          expressionKind: reference.expressionKind,
        },
      });
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function createReferenceClassKey(referenceId: string, className: string): string {
  return `${referenceId}:${className}`;
}

function buildMissingClassTraces(input: {
  reference: RuleContext["analysis"]["entities"]["classReferences"][number];
  className: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}`,
      category: "rule-evaluation",
      summary: `class "${input.className}" was looked up from a definite class reference, but no definition or provider satisfaction was found`,
      anchor: input.reference.location,
      children: [
        ...input.reference.traces,
        {
          traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}:definition-lookup`,
          category: "rule-evaluation",
          summary: `no class definitions were indexed for "${input.className}"`,
          anchor: input.reference.location,
          children: [],
          metadata: {
            className: input.className,
          },
        },
        {
          traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}:provider-lookup`,
          category: "rule-evaluation",
          summary: `no declared external provider satisfied "${input.className}" for this reference`,
          anchor: input.reference.location,
          children: [],
          metadata: {
            className: input.className,
          },
        },
      ],
      metadata: {
        ruleId: "missing-css-class",
        className: input.className,
        referenceId: input.reference.id,
        sourceFileId: input.reference.sourceFileId,
        rawExpressionText: input.reference.rawExpressionText,
      },
    },
  ];
}
