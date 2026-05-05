import type {
  AnalysisTrace,
  ClassDefinitionAnalysis,
  SelectorBranchAnalysis,
  StaticallySkippedClassReferenceAnalysis,
  StylesheetAnalysis,
} from "../../static-analysis-engine/index.js";
import {
  getClassDefinitions,
  getClassReferences,
  getClassReferencesByClassName,
  getProviderBackedStylesheetRelationsByStylesheetId,
  getSelectorBranches,
  getSelectorBranchesByStylesheetId,
  getStaticallySkippedClassReferencesByClassName,
  getStylesheetById,
  getStylesheetReachabilityByStylesheetId,
} from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unusedCssClassRule: RuleDefinition = {
  id: "unused-css-class",
  run(context) {
    return runUnusedCssClassRule(context);
  },
};

function runUnusedCssClassRule(context: RuleContext): UnresolvedFinding[] {
  const definitionsByClassAndStylesheet = new Map<
    string,
    Array<{
      definition: ClassDefinitionAnalysis;
      stylesheet: StylesheetAnalysis;
    }>
  >();
  const hasUnknownDynamicReferences = getClassReferences(context.analysisEvidence).some(
    (reference) => reference.unknownDynamic,
  );

  for (const definition of getClassDefinitions(context.analysisEvidence)) {
    const stylesheet = getStylesheetById(context.analysisEvidence, definition.stylesheetId);
    if (!stylesheet || stylesheet.origin === "external-import" || definition.isCssModule) {
      continue;
    }
    if (
      getProviderBackedStylesheetRelationsByStylesheetId(
        context.analysisEvidence,
        definition.stylesheetId,
      ).some((relation) => relation.suppressUnused)
    ) {
      continue;
    }

    if (getClassReferencesByClassName(context.analysisEvidence, definition.className).length > 0) {
      continue;
    }

    if (isDefinitionMatchedBySelectorBranch(context, definition)) {
      continue;
    }

    const key = `${definition.stylesheetId}:${definition.className}`;
    const definitions = definitionsByClassAndStylesheet.get(key);
    if (definitions) {
      definitions.push({ definition, stylesheet });
    } else {
      definitionsByClassAndStylesheet.set(key, [{ definition, stylesheet }]);
    }
  }

  return [...definitionsByClassAndStylesheet.values()]
    .map((definitions) =>
      buildUnusedClassFinding({
        context,
        definitions,
        hasUnknownDynamicReferences,
      }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function isDefinitionMatchedBySelectorBranch(
  context: RuleContext,
  definition: ClassDefinitionAnalysis,
): boolean {
  if (
    definition.selectorKind === "simple-root" ||
    definition.selectorKind === "unsupported" ||
    !definition.sourceDefinition.selectorBranch.subjectClassNames.includes(definition.className)
  ) {
    return false;
  }

  const stylesheet = getStylesheetById(context.analysisEvidence, definition.stylesheetId);
  const branchesById = new Map<string, SelectorBranchAnalysis>();
  for (const branch of getSelectorBranchesByStylesheetId(
    context.analysisEvidence,
    definition.stylesheetId,
  )) {
    branchesById.set(branch.id, branch);
  }
  for (const branch of getSelectorBranches(context.analysisEvidence)) {
    if (sameAnalysisPath(branch.location?.filePath, stylesheet?.filePath)) {
      branchesById.set(branch.id, branch);
    }
  }
  const branches = [...branchesById.values()];

  return branches.some((branch) => {
    const isMatchable =
      branch.selectorReachabilityStatus === "definitely-matchable" ||
      branch.selectorReachabilityStatus === "possibly-matchable" ||
      branch.selectorReachabilityStatus === "only-matches-in-unknown-context";

    return (
      isMatchable &&
      branch.selectorText === definition.selectorText &&
      (branch.stylesheetId === definition.stylesheetId ||
        sameAnalysisPath(branch.location?.filePath, stylesheet?.filePath))
    );
  });
}

function sameAnalysisPath(left?: string, right?: string): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  const normalizedLeft = normalizeAnalysisPath(left);
  const normalizedRight = normalizeAnalysisPath(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function normalizeAnalysisPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function buildUnusedClassFinding(input: {
  context: RuleContext;
  definitions: Array<{
    definition: ClassDefinitionAnalysis;
    stylesheet: StylesheetAnalysis;
  }>;
  hasUnknownDynamicReferences: boolean;
}): UnresolvedFinding {
  const definitions = input.definitions.sort(
    (left, right) => left.definition.line - right.definition.line,
  );
  const first = definitions[0];
  const className = first.definition.className;
  const stylesheet = first.stylesheet;
  const definitionLocations = buildDefinitionLocations(definitions);
  const selectorTexts = [
    ...new Set(definitions.map((entry) => entry.definition.selectorText)),
  ].sort((left, right) => left.localeCompare(right));
  const skippedReferences = getStaticallySkippedReferences(input.context, className);
  const skippedReferenceLocations = buildSkippedReferenceLocations(skippedReferences);

  return {
    id: `unused-css-class:${first.definition.stylesheetId}:${className}`,
    ruleId: "unused-css-class",
    confidence: input.hasUnknownDynamicReferences ? "medium" : "high",
    message: buildUnusedClassMessage({
      className,
      definitionCount: definitions.length,
      hasOnlyStaticallySkippedReferences: skippedReferences.length > 0,
    }),
    subject: {
      kind: "class-definition",
      id: first.definition.id,
    },
    location: stylesheet.filePath
      ? {
          filePath: stylesheet.filePath,
          startLine: first.definition.line,
          startColumn: 1,
        }
      : undefined,
    evidence: buildUnusedClassEvidence(definitions, skippedReferences),
    traces:
      input.context.includeTraces === false
        ? []
        : definitions.flatMap((entry) =>
            buildUnusedClassTraces({
              context: input.context,
              definition: entry.definition,
              stylesheetFilePath: entry.stylesheet.filePath,
            }),
          ),
    data: {
      className,
      selectorText: first.definition.selectorText,
      selectorTexts,
      definitionCount: definitions.length,
      definitionLocations,
      stylesheetId: first.definition.stylesheetId,
      stylesheetFilePath: stylesheet.filePath,
      usageReason:
        skippedReferences.length > 0
          ? "only-in-statically-skipped-render-branches"
          : "no-known-react-class-reference",
      ...(skippedReferenceLocations.length > 0
        ? { staticallySkippedReferenceLocations: skippedReferenceLocations }
        : {}),
    },
  };
}

function buildUnusedClassMessage(input: {
  className: string;
  definitionCount: number;
  hasOnlyStaticallySkippedReferences: boolean;
}): string {
  const definitionText =
    input.definitionCount === 1 ? "is defined" : `is defined ${input.definitionCount} times`;
  if (input.hasOnlyStaticallySkippedReferences) {
    return `Class "${input.className}" ${definitionText} and is only referenced in render branches that static analysis determined never run.`;
  }

  return `Class "${input.className}" ${definitionText} but no known React class reference uses it.`;
}

function buildUnusedClassEvidence(
  definitions: Array<{
    definition: ClassDefinitionAnalysis;
    stylesheet: StylesheetAnalysis;
  }>,
  skippedReferences: StaticallySkippedClassReferenceAnalysis[],
): UnresolvedFinding["evidence"] {
  const evidenceByKey = new Map<string, UnresolvedFinding["evidence"][number]>();

  for (const { definition } of definitions) {
    evidenceByKey.set(`stylesheet:${definition.stylesheetId}`, {
      kind: "stylesheet",
      id: definition.stylesheetId,
    });
    evidenceByKey.set(`class-definition:${definition.id}`, {
      kind: "class-definition",
      id: definition.id,
    });
  }

  for (const reference of skippedReferences) {
    evidenceByKey.set(`statically-skipped-class-reference:${reference.id}`, {
      kind: "statically-skipped-class-reference",
      id: reference.id,
    });
  }

  return [...evidenceByKey.values()];
}

function getStaticallySkippedReferences(
  context: RuleContext,
  className: string,
): StaticallySkippedClassReferenceAnalysis[] {
  return getStaticallySkippedClassReferencesByClassName(context.analysisEvidence, className).sort(
    (left, right) =>
      left.location.filePath.localeCompare(right.location.filePath) ||
      left.location.startLine - right.location.startLine ||
      left.location.startColumn - right.location.startColumn,
  );
}

function buildSkippedReferenceLocations(
  references: StaticallySkippedClassReferenceAnalysis[],
): Array<{
  filePath: string;
  startLine: number;
  rawExpressionText: string;
  conditionSourceText: string;
  skippedBranch: "when-true" | "when-false";
  reason: string;
}> {
  return references.map((reference) => ({
    filePath: reference.location.filePath,
    startLine: reference.location.startLine,
    rawExpressionText: reference.rawExpressionText,
    conditionSourceText: reference.conditionSourceText,
    skippedBranch: reference.skippedBranch,
    reason: reference.reason,
  }));
}

function buildDefinitionLocations(
  definitions: Array<{
    definition: ClassDefinitionAnalysis;
    stylesheet: StylesheetAnalysis;
  }>,
): Array<{
  filePath: string;
  startLine: number;
  selectorText: string;
}> {
  const locationsByKey = new Map<
    string,
    {
      filePath: string;
      startLine: number;
      selectorText: string;
    }
  >();

  for (const { definition, stylesheet } of definitions) {
    if (!stylesheet.filePath) {
      continue;
    }

    const key = [stylesheet.filePath, definition.line, definition.selectorText].join(":");
    locationsByKey.set(key, {
      filePath: stylesheet.filePath,
      startLine: definition.line,
      selectorText: definition.selectorText,
    });
  }

  return [...locationsByKey.values()].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.startLine - right.startLine ||
      left.selectorText.localeCompare(right.selectorText),
  );
}

function buildUnusedClassTraces(input: {
  context: RuleContext;
  definition: ClassDefinitionAnalysis;
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  const reachabilityTraces = getStylesheetReachabilityByStylesheetId(
    input.context.analysisEvidence,
    input.definition.stylesheetId,
  ).flatMap((relation) => relation.traces);

  return [
    {
      traceId: `rule-evaluation:unused-css-class:${input.definition.id}`,
      category: "rule-evaluation",
      summary: `class "${input.definition.className}" was looked up in known class references, but no reference was found`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: input.definition.line,
            startColumn: 1,
          }
        : undefined,
      children: [
        ...reachabilityTraces,
        {
          traceId: `rule-evaluation:unused-css-class:${input.definition.id}:reference-lookup`,
          category: "rule-evaluation",
          summary: `no definite or possible class references were indexed for "${input.definition.className}"`,
          children: [],
          metadata: {
            className: input.definition.className,
          },
        },
      ],
      metadata: {
        ruleId: "unused-css-class",
        className: input.definition.className,
        definitionId: input.definition.id,
        stylesheetId: input.definition.stylesheetId,
      },
    },
  ];
}
