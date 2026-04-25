import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unusedCssModuleClassRule: RuleDefinition = {
  id: "unused-css-module-class",
  run(context) {
    return runUnusedCssModuleClassRule(context);
  },
};

function runUnusedCssModuleClassRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const definition of context.analysis.entities.classDefinitions) {
    if (
      !definition.isCssModule ||
      context.analysis.indexes.cssModuleMemberMatchesByDefinitionId.has(definition.id)
    ) {
      continue;
    }

    const stylesheet = context.analysis.indexes.stylesheetsById.get(definition.stylesheetId);
    if (!stylesheet) {
      continue;
    }

    findings.push({
      id: `unused-css-module-class:${definition.id}`,
      ruleId: "unused-css-module-class",
      confidence: "high",
      message: `CSS Module class "${definition.className}" is exported but never used by a known module import.`,
      subject: {
        kind: "class-definition",
        id: definition.id,
      },
      location: stylesheet.filePath
        ? {
            filePath: stylesheet.filePath,
            startLine: definition.line,
            startColumn: 1,
          }
        : undefined,
      evidence: [
        {
          kind: "stylesheet",
          id: definition.stylesheetId,
        },
      ],
      traces: buildUnusedCssModuleClassTraces({
        context,
        definition,
        stylesheetFilePath: stylesheet.filePath,
      }),
      data: {
        className: definition.className,
        selectorText: definition.selectorText,
        stylesheetId: definition.stylesheetId,
        stylesheetFilePath: stylesheet.filePath,
      },
    });
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildUnusedCssModuleClassTraces(input: {
  context: RuleContext;
  definition: RuleContext["analysis"]["entities"]["classDefinitions"][number];
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  const importIds =
    input.context.analysis.indexes.cssModuleImportsByStylesheetId.get(
      input.definition.stylesheetId,
    ) ?? [];

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
