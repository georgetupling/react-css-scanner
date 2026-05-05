import type { AnalysisTrace, ClassDefinitionAnalysis } from "../../static-analysis-engine/index.js";
import {
  getClassDefinitions,
  getCssModuleImportsByStylesheetId,
  getCssModuleMemberMatches,
  getCssModuleReferenceDiagnostics,
  getStylesheetById,
} from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unusedCssModuleClassRule: RuleDefinition = {
  id: "unused-css-module-class",
  run(context) {
    return runUnusedCssModuleClassRule(context);
  },
};

function runUnusedCssModuleClassRule(context: RuleContext): UnresolvedFinding[] {
  const usedDefinitionKeys = new Set(
    getCssModuleMemberMatches(context.analysisEvidence)
      .filter((match) => match.status === "matched")
      .map((match) => createDefinitionKey(match.stylesheetId, match.className)),
  );
  const stylesheetsWithComputedModuleReads = new Set(
    getCssModuleReferenceDiagnostics(context.analysisEvidence)
      .filter((diagnostic) => diagnostic.reason === "computed-css-module-member")
      .map((diagnostic) => diagnostic.stylesheetId),
  );
  const definitionsByClassAndStylesheet = new Map<
    string,
    Array<{
      definition: ClassDefinitionAnalysis;
      stylesheetFilePath?: string;
    }>
  >();

  for (const definition of getClassDefinitions(context.analysisEvidence)) {
    if (!definition.isCssModule) {
      continue;
    }

    const stylesheet = getStylesheetById(context.analysisEvidence, definition.stylesheetId);
    if (!stylesheet) {
      continue;
    }

    const definitionKey = createDefinitionKey(definition.stylesheetId, definition.className);
    if (
      usedDefinitionKeys.has(definitionKey) ||
      stylesheetsWithComputedModuleReads.has(definition.stylesheetId)
    ) {
      continue;
    }

    const definitions = definitionsByClassAndStylesheet.get(definitionKey);
    const entry = { definition, stylesheetFilePath: stylesheet.filePath };
    if (definitions) {
      definitions.push(entry);
    } else {
      definitionsByClassAndStylesheet.set(definitionKey, [entry]);
    }
  }

  return [...definitionsByClassAndStylesheet.values()]
    .map((definitions) => buildUnusedCssModuleClassFinding({ context, definitions }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createDefinitionKey(stylesheetId: string, className: string): string {
  return `${stylesheetId}:${className}`;
}

function buildUnusedCssModuleClassFinding(input: {
  context: RuleContext;
  definitions: Array<{
    definition: ClassDefinitionAnalysis;
    stylesheetFilePath?: string;
  }>;
}): UnresolvedFinding {
  const definitions = input.definitions.sort(
    (left, right) => left.definition.line - right.definition.line,
  );
  const first = definitions[0];
  const definition = first.definition;
  const selectorTexts = [
    ...new Set(definitions.map((entry) => entry.definition.selectorText)),
  ].sort((left, right) => left.localeCompare(right));

  return {
    id: `unused-css-module-class:${definition.stylesheetId}:${definition.className}`,
    ruleId: "unused-css-module-class",
    confidence: "high",
    message: `CSS Module class "${definition.className}" is exported but never used by a known module import.`,
    subject: {
      kind: "class-definition",
      id: definition.id,
    },
    location: first.stylesheetFilePath
      ? {
          filePath: first.stylesheetFilePath,
          startLine: definition.line,
          startColumn: 1,
        }
      : undefined,
    evidence: buildUnusedCssModuleClassEvidence(definitions),
    traces:
      input.context.includeTraces === false
        ? []
        : definitions.flatMap((entry) =>
            buildUnusedCssModuleClassTraces({
              context: input.context,
              definition: entry.definition,
              stylesheetFilePath: entry.stylesheetFilePath,
            }),
          ),
    data: {
      className: definition.className,
      selectorText: definition.selectorText,
      selectorTexts,
      definitionCount: definitions.length,
      stylesheetId: definition.stylesheetId,
      stylesheetFilePath: first.stylesheetFilePath,
    },
  };
}

function buildUnusedCssModuleClassEvidence(
  definitions: Array<{
    definition: ClassDefinitionAnalysis;
  }>,
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

  return [...evidenceByKey.values()];
}

function buildUnusedCssModuleClassTraces(input: {
  context: RuleContext;
  definition: ClassDefinitionAnalysis;
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  const importIds = getCssModuleImportsByStylesheetId(
    input.context.analysisEvidence,
    input.definition.stylesheetId,
  ).map((importRecord) => importRecord.id);

  return [
    {
      traceId: `rule-evaluation:unused-css-module-class:${input.definition.id}`,
      category: "rule-evaluation",
      summary: `CSS Module class "${input.definition.className}" was exported, but no matching member reference was found`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: input.definition.line,
            startColumn: 1,
          }
        : undefined,
      children: [
        {
          traceId: `rule-evaluation:unused-css-module-class:${input.definition.id}:member-lookup`,
          category: "rule-evaluation",
          summary: `no CSS Module member reference matched "${input.definition.className}"`,
          children: [],
          metadata: {
            className: input.definition.className,
            importIds,
            stylesheetId: input.definition.stylesheetId,
          },
        },
      ],
      metadata: {
        ruleId: "unused-css-module-class",
        className: input.definition.className,
        definitionId: input.definition.id,
        stylesheetId: input.definition.stylesheetId,
      },
    },
  ];
}
