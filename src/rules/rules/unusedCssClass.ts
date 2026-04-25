import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const unusedCssClassRule: RuleDefinition = {
  id: "unused-css-class",
  run(context) {
    return runUnusedCssClassRule(context);
  },
};

function runUnusedCssClassRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];
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

    findings.push({
      id: `unused-css-class:${definition.id}`,
      ruleId: "unused-css-class",
      confidence: hasUnknownDynamicReferences ? "medium" : "high",
      message: `Class "${definition.className}" is defined but no known React class reference uses it.`,
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
      traces: buildUnusedClassTraces({
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
