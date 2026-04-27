import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
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
      definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
      stylesheet: NonNullable<
        ReturnType<RuleContext["analysis"]["indexes"]["stylesheetsById"]["get"]>
      >;
    }>
  >();
  const hasUnknownDynamicReferences = context.analysis.entities.classReferences.some(
    (reference) => reference.unknownDynamic,
  );

  for (const definition of context.analysis.entities.classDefinitions) {
    const stylesheet = context.analysis.indexes.stylesheetsById.get(definition.stylesheetId);
    if (!stylesheet || stylesheet.origin === "external-import" || definition.isCssModule) {
      continue;
    }

    const referenceIds = context.analysis.indexes.referencesByClassName.get(definition.className);
    if (referenceIds && referenceIds.length > 0) {
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
  definition: RuleContext["analysis"]["entities"]["classDefinitions"][number],
): boolean {
  if (
    definition.selectorKind === "simple-root" ||
    definition.selectorKind === "unsupported" ||
    !definition.sourceDefinition.selectorBranch.subjectClassNames.includes(definition.className)
  ) {
    return false;
  }

  const stylesheet = context.analysis.indexes.stylesheetsById.get(definition.stylesheetId);
  const branchIds = context.analysis.indexes.selectorBranchesByStylesheetId.get(
    definition.stylesheetId,
  );
  const branchesById = new Map<
    string,
    RuleContext["analysis"]["entities"]["selectorBranches"][number]
  >();
  for (const branchId of branchIds ?? []) {
    const branch = context.analysis.indexes.selectorBranchesById.get(branchId);
    if (branch) {
      branchesById.set(branch.id, branch);
    }
  }
  for (const branch of context.analysis.entities.selectorBranches) {
    if (sameAnalysisPath(branch.location?.filePath, stylesheet?.filePath)) {
      branchesById.set(branch.id, branch);
    }
  }
  const branches = [...branchesById.values()];

  return branches.some((branch) => {
    return (
      (branch.outcome === "match" || branch.outcome === "possible-match") &&
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
    definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
    stylesheet: NonNullable<
      ReturnType<RuleContext["analysis"]["indexes"]["stylesheetsById"]["get"]>
    >;
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
    definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
    stylesheet: NonNullable<
      ReturnType<RuleContext["analysis"]["indexes"]["stylesheetsById"]["get"]>
    >;
  }>,
  skippedReferences: RuleContext["analysis"]["entities"]["staticallySkippedClassReferences"],
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
): RuleContext["analysis"]["entities"]["staticallySkippedClassReferences"] {
  if (
    !context.analysis.indexes.staticallySkippedReferencesByClassName ||
    !context.analysis.indexes.staticallySkippedClassReferencesById
  ) {
    return [];
  }

  const referenceIds =
    context.analysis.indexes.staticallySkippedReferencesByClassName.get(className) ?? [];
  return referenceIds
    .map((referenceId) =>
      context.analysis.indexes.staticallySkippedClassReferencesById.get(referenceId),
    )
    .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
    .sort(
      (left, right) =>
        left.location.filePath.localeCompare(right.location.filePath) ||
        left.location.startLine - right.location.startLine ||
        left.location.startColumn - right.location.startColumn,
    );
}

function buildSkippedReferenceLocations(
  references: RuleContext["analysis"]["entities"]["staticallySkippedClassReferences"],
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
    definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
    stylesheet: NonNullable<
      ReturnType<RuleContext["analysis"]["indexes"]["stylesheetsById"]["get"]>
    >;
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
  definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  const reachabilityTraces = input.context.analysis.relations.stylesheetReachability
    .filter((relation) => relation.stylesheetId === input.definition.stylesheetId)
    .flatMap((relation) => relation.traces);

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
