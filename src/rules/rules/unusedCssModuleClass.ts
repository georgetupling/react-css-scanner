import type { AnalysisTrace, ClassDefinitionAnalysis } from "../../static-analysis-engine/index.js";
import {
  getClassDefinitions,
  getCssModuleImportsByStylesheetId,
  getCssModuleMemberMatchesByDefinitionId,
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
  const findings: UnresolvedFinding[] = [];

  for (const definition of getClassDefinitions(context.analysisEvidence)) {
    if (
      !definition.isCssModule ||
      getCssModuleMemberMatchesByDefinitionId(context.analysisEvidence, definition.id).length > 0
    ) {
      continue;
    }

    const stylesheet = getStylesheetById(context.analysisEvidence, definition.stylesheetId);
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
      traces:
        context.includeTraces === false
          ? []
          : buildUnusedCssModuleClassTraces({
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
