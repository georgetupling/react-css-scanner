import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import type { AnalysisTrace, ClassReferenceAnalysis } from "../../static-analysis-engine/index.js";
import {
  getClassContextsByClassName,
  getClassDefinitionsByClassName,
  getClassReferences,
  getComponentById,
  hasProviderSatisfactionForReferenceClass,
} from "../analysisQueries.js";

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
      reference: ClassReferenceAnalysis;
      className: string;
    }>
  >();

  for (const reference of getClassReferences(context.analysisEvidence)) {
    for (const className of reference.definiteClassNames) {
      if (getClassDefinitionsByClassName(context.analysisEvidence, className).length > 0) {
        continue;
      }

      if (getClassContextsByClassName(context.analysisEvidence, className).length > 0) {
        continue;
      }

      if (
        hasProviderSatisfactionForReferenceClass({
          analysis: context.analysisEvidence,
          referenceId: reference.id,
          className,
        })
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

function buildMissingClassFinding(
  context: RuleContext,
  className: string,
  inputs: Array<{
    reference: ClassReferenceAnalysis;
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
  const runtimeLibraryHint = buildRuntimeLibraryHint(context, className, references);

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
      ...(runtimeLibraryHint ? { runtimeLibraryHint } : {}),
      focusFilePaths: collectReferenceFocusFilePaths(context, className, references),
    },
  };
}

function buildMissingClassMessage(className: string, usageCount: number): string {
  const referenceText = usageCount === 1 ? "is referenced" : `is referenced ${usageCount} times`;
  return `Class "${className}" ${referenceText} but no matching CSS definition, selector context, or declared provider was found.`;
}

function buildMissingClassEvidence(
  references: ClassReferenceAnalysis[],
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
  references: ClassReferenceAnalysis[],
): string[] {
  const paths = new Set<string>();
  for (const reference of references) {
    const componentId = reference.classNameComponentIds?.[className] ?? reference.componentId;
    const component = componentId
      ? getComponentById(context.analysisEvidence, componentId)
      : undefined;
    paths.add(component?.filePath ?? reference.location.filePath);
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function dedupeUsageLocations(references: ClassReferenceAnalysis[]): Array<{
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
  left: ClassReferenceAnalysis,
  right: ClassReferenceAnalysis,
): number {
  return (
    left.location.filePath.localeCompare(right.location.filePath) ||
    left.location.startLine - right.location.startLine ||
    left.location.startColumn - right.location.startColumn
  );
}

function buildMissingClassTraces(input: {
  reference: ClassReferenceAnalysis;
  className: string;
}): AnalysisTrace[] {
  const runtimeLibraryHint = input.reference.runtimeLibraryHint;
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
        ...(runtimeLibraryHint
          ? [
              {
                traceId: `rule-evaluation:missing-css-class:${input.reference.id}:${input.className}:runtime-library-hint`,
                category: "rule-evaluation" as const,
                summary: `runtime DOM class reference was associated with "${runtimeLibraryHint.packageName}" via "${runtimeLibraryHint.localName}"`,
                anchor: input.reference.location,
                children: [],
                metadata: {
                  className: input.className,
                  runtimeLibraryHint,
                },
              },
            ]
          : []),
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

function buildRuntimeLibraryHint(
  context: RuleContext,
  className: string,
  references: ClassReferenceAnalysis[],
): Record<string, unknown> | undefined {
  const runtimeHint = references
    .map((reference) => reference.runtimeLibraryHint)
    .find((hint) => hint !== undefined);
  if (!runtimeHint) {
    return undefined;
  }

  const packageCssImports = (context.externalCssPackageImports ?? []).filter(
    (importRecord) =>
      getPackageNameFromSpecifier(importRecord.specifier) === runtimeHint.packageName,
  );
  const cssImportFound = packageCssImports.length > 0;

  return {
    packageName: runtimeHint.packageName,
    importedName: runtimeHint.importedName,
    localName: runtimeHint.localName,
    cssImportFound,
    importedPackageCssSpecifiers: packageCssImports
      .map((importRecord) => importRecord.specifier)
      .sort((left, right) => left.localeCompare(right)),
    message: cssImportFound
      ? `Class "${className}" is referenced by runtime DOM code from "${runtimeHint.packageName}", and package CSS from that package was imported, but no CSS definition for this class was found. If this class is library-styled, import the package CSS file that defines it or define it locally.`
      : `Class "${className}" is referenced by runtime DOM code from "${runtimeHint.packageName}", but no package CSS import was found. If this class is library-styled, import the package CSS or define it locally.`,
  };
}

function getPackageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  return segments[0] ?? specifier;
}
