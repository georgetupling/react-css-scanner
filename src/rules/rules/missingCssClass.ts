import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import type { AnalysisTrace } from "../../static-analysis-engine/index.js";

export const missingCssClassRule: RuleDefinition = {
  id: "missing-css-class",
  run(context) {
    return runMissingCssClassRule(context);
  },
};

function runMissingCssClassRule(context: RuleContext): UnresolvedFinding[] {
  const findingInputsByClassName = new Map<
    string,
    Array<{
      reference: RuleContext["analysis"]["entities"]["classReferences"][number];
      className: string;
    }>
  >();

  for (const reference of context.analysis.entities.classReferences) {
    for (const className of reference.definiteClassNames) {
      if (context.analysis.indexes.definitionsByClassName.has(className)) {
        continue;
      }

      if (context.analysis.indexes.contextsByClassName.has(className)) {
        continue;
      }

      if (
        context.analysis.indexes.providerSatisfactionsByReferenceAndClassName.has(
          createReferenceClassKey(reference.id, className),
        )
      ) {
        continue;
      }

      const inputs = findingInputsByClassName.get(className);
      if (inputs) {
        inputs.push({ reference, className });
      } else {
        findingInputsByClassName.set(className, [{ reference, className }]);
      }
    }
  }

  return [...findingInputsByClassName.entries()]
    .map(([className, inputs]) => buildMissingClassFinding(context, className, inputs))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createReferenceClassKey(referenceId: string, className: string): string {
  return `${referenceId}:${className}`;
}

function buildMissingClassFinding(
  context: RuleContext,
  className: string,
  inputs: Array<{
    reference: RuleContext["analysis"]["entities"]["classReferences"][number];
    className: string;
  }>,
): UnresolvedFinding {
  const references = inputs
    .map((input) => input.reference)
    .sort(
      (left, right) => compareReferenceLocations(left, right) || left.id.localeCompare(right.id),
    );
  const firstReference = references[0];
  const usageLocations = dedupeUsageLocations(references);

  return {
    id: `missing-css-class:${className}`,
    ruleId: "missing-css-class",
    confidence: "high",
    message: buildMissingClassMessage(className, references.length),
    subject: {
      kind: "class-reference",
      id: firstReference.id,
    },
    location: firstReference.location,
    evidence: buildMissingClassEvidence(references),
    traces:
      context.includeTraces === false
        ? []
        : references.flatMap((reference) =>
            buildMissingClassTraces({
              reference,
              className,
            }),
          ),
    data: {
      className,
      rawExpressionText: firstReference.rawExpressionText,
      expressionKind: firstReference.expressionKind,
      usageCount: references.length,
      usageLocations,
      focusFilePaths: collectReferenceFocusFilePaths(context, className, references),
    },
  };
}

function buildMissingClassMessage(className: string, usageCount: number): string {
  const referenceText = usageCount === 1 ? "is referenced" : `is referenced ${usageCount} times`;
  return `Class "${className}" ${referenceText} but no matching CSS definition, selector context, or declared provider was found.`;
}

function buildMissingClassEvidence(
  references: RuleContext["analysis"]["entities"]["classReferences"],
): UnresolvedFinding["evidence"] {
  const evidenceByKey = new Map<string, UnresolvedFinding["evidence"][number]>();

  for (const reference of references) {
    evidenceByKey.set(`source-file:${reference.sourceFileId}`, {
      kind: "source-file",
      id: reference.sourceFileId,
    });
    evidenceByKey.set(`class-reference:${reference.id}`, {
      kind: "class-reference",
      id: reference.id,
    });
  }

  return [...evidenceByKey.values()];
}

function collectReferenceFocusFilePaths(
  context: RuleContext,
  className: string,
  references: RuleContext["analysis"]["entities"]["classReferences"],
): string[] {
  const paths = new Set<string>();
  for (const reference of references) {
    const componentId = reference.classNameComponentIds?.[className] ?? reference.componentId;
    const component = componentId
      ? context.analysis.indexes.componentsById.get(componentId)
      : undefined;
    paths.add(component?.filePath ?? reference.location.filePath);
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function dedupeUsageLocations(
  references: RuleContext["analysis"]["entities"]["classReferences"],
): Array<{
  filePath: string;
  startLine: number;
  startColumn: number;
  rawExpressionText: string;
}> {
  const locationsByKey = new Map<
    string,
    {
      filePath: string;
      startLine: number;
      startColumn: number;
      rawExpressionText: string;
    }
  >();

  for (const reference of references) {
    const key = [
      reference.location.filePath,
      reference.location.startLine,
      reference.location.startColumn,
      reference.rawExpressionText,
    ].join(":");
    locationsByKey.set(key, {
      filePath: reference.location.filePath,
      startLine: reference.location.startLine,
      startColumn: reference.location.startColumn,
      rawExpressionText: reference.rawExpressionText,
    });
  }

  return [...locationsByKey.values()].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn ||
      left.rawExpressionText.localeCompare(right.rawExpressionText),
  );
}

function compareReferenceLocations(
  left: RuleContext["analysis"]["entities"]["classReferences"][number],
  right: RuleContext["analysis"]["entities"]["classReferences"][number],
): number {
  return (
    left.location.filePath.localeCompare(right.location.filePath) ||
    left.location.startLine - right.location.startLine ||
    left.location.startColumn - right.location.startColumn
  );
}

function buildMissingClassTraces(input: {
  reference: RuleContext["analysis"]["entities"]["classReferences"][number];
  className: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}`,
      category: "rule-evaluation",
      summary: `class "${input.className}" was looked up from a definite class reference, but no definition or provider satisfaction was found, and no selector context was indexed`,
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
        {
          traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}:context-lookup`,
          category: "rule-evaluation",
          summary: `no selector context mentions were indexed for "${input.className}"`,
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
