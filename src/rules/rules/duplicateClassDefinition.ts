import type { AnalysisTrace, ClassDefinitionAnalysis } from "../../static-analysis-engine/index.js";
import { getClassDefinitions, getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const duplicateClassDefinitionRule: RuleDefinition = {
  id: "duplicate-class-definition",
  run(context) {
    return runDuplicateClassDefinitionRule(context);
  },
};

function runDuplicateClassDefinitionRule(context: RuleContext): UnresolvedFinding[] {
  const groups = new Map<string, ClassDefinitionAnalysis[]>();

  for (const definition of getClassDefinitions(context.analysisEvidence)) {
    const stylesheet = getStylesheetById(context.analysisEvidence, definition.stylesheetId);
    if (!stylesheet || stylesheet.origin === "external-import") {
      continue;
    }

    const key = createDuplicateDefinitionKey(definition);
    const definitions = groups.get(key) ?? [];
    definitions.push(definition);
    groups.set(key, definitions);
  }

  return [...groups.values()]
    .filter((definitions) => definitions.length > 1)
    .map((definitions) => buildDuplicateClassDefinitionFinding({ context, definitions }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createDuplicateDefinitionKey(definition: ClassDefinitionAnalysis): string {
  return [
    definition.stylesheetId,
    definition.className,
    definition.selectorText,
    serializeAtRuleContext(definition),
  ].join("::");
}

function serializeAtRuleContext(definition: ClassDefinitionAnalysis): string {
  return JSON.stringify(
    definition.atRuleContext.map((atRule) => ({
      name: atRule.name,
      params: atRule.params,
    })),
  );
}

function buildDuplicateClassDefinitionFinding(input: {
  context: RuleContext;
  definitions: ClassDefinitionAnalysis[];
}): UnresolvedFinding {
  const definitions = [...input.definitions].sort(
    (left, right) => left.line - right.line || left.id.localeCompare(right.id),
  );
  const first = definitions[0];
  const stylesheet = getStylesheetById(input.context.analysisEvidence, first.stylesheetId);
  const declarationSignatures = [
    ...new Set(definitions.map((definition) => definition.declarationSignature)),
  ].sort((left, right) => left.localeCompare(right));
  const hasConflictingDeclarations = declarationSignatures.length > 1;

  return {
    id: `duplicate-class-definition:${first.stylesheetId}:${first.className}:${first.selectorText}:${definitions.map((definition) => definition.line).join("-")}`,
    ruleId: "duplicate-class-definition",
    confidence: "high",
    message: buildDuplicateClassDefinitionMessage({
      className: first.className,
      selectorText: first.selectorText,
      count: definitions.length,
      hasConflictingDeclarations,
    }),
    subject: {
      kind: "class-definition",
      id: first.id,
    },
    location: stylesheet?.filePath
      ? {
          filePath: stylesheet.filePath,
          startLine: first.line,
          startColumn: 1,
        }
      : undefined,
    evidence: [
      {
        kind: "stylesheet",
        id: first.stylesheetId,
      },
      ...definitions.map((definition) => ({
        kind: "class-definition" as const,
        id: definition.id,
      })),
    ],
    traces:
      input.context.includeTraces === false
        ? []
        : buildDuplicateClassDefinitionTraces({
            definitions,
            stylesheetFilePath: stylesheet?.filePath,
          }),
    data: {
      className: first.className,
      selectorText: first.selectorText,
      stylesheetId: first.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      definitionCount: definitions.length,
      hasConflictingDeclarations,
      declarationSignatures,
      definitionLocations: definitions.map((definition) => ({
        filePath: stylesheet?.filePath,
        startLine: definition.line,
        selectorText: definition.selectorText,
      })),
    },
  };
}

function buildDuplicateClassDefinitionMessage(input: {
  className: string;
  selectorText: string;
  count: number;
  hasConflictingDeclarations: boolean;
}): string {
  const declarationText = input.hasConflictingDeclarations ? " with different declarations" : "";
  return `Class "${input.className}" is defined by selector "${input.selectorText}" ${input.count} times in the same stylesheet scope${declarationText}.`;
}

function buildDuplicateClassDefinitionTraces(input: {
  definitions: ClassDefinitionAnalysis[];
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  const first = input.definitions[0];
  return [
    {
      traceId: `rule-evaluation:duplicate-class-definition:${first.stylesheetId}:${first.id}`,
      category: "rule-evaluation",
      summary: `duplicate class definitions were found for selector "${first.selectorText}"`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: first.line,
            startColumn: 1,
          }
        : undefined,
      children: [],
      metadata: {
        ruleId: "duplicate-class-definition",
        className: first.className,
        selectorText: first.selectorText,
        stylesheetId: first.stylesheetId,
        definitionIds: input.definitions.map((definition) => definition.id),
      },
    },
  ];
}
