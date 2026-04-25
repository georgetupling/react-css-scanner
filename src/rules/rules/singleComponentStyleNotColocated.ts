import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

const COLOCATION_REASONS = new Set([
  "same-directory",
  "sibling-basename-convention",
  "component-folder-convention",
  "feature-folder-convention",
]);

export const singleComponentStyleNotColocatedRule: RuleDefinition = {
  id: "single-component-style-not-colocated",
  run(context) {
    return runSingleComponentStyleNotColocatedRule(context);
  },
};

function runSingleComponentStyleNotColocatedRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const ownership of context.analysis.entities.classOwnership) {
    const definition = context.analysis.indexes.classDefinitionsById.get(
      ownership.classDefinitionId,
    );
    const stylesheet = context.analysis.indexes.stylesheetsById.get(ownership.stylesheetId);
    if (
      !definition ||
      !stylesheet ||
      definition.isCssModule ||
      stylesheet.origin !== "project-css" ||
      ownership.consumerSummary.consumerComponentIds.length !== 1
    ) {
      continue;
    }

    const componentId = ownership.consumerSummary.consumerComponentIds[0];
    const component = context.analysis.indexes.componentsById.get(componentId);
    if (!component || hasColocationEvidence(ownership, componentId)) {
      continue;
    }

    findings.push({
      id: `single-component-style-not-colocated:${ownership.id}`,
      ruleId: "single-component-style-not-colocated",
      confidence: ownership.confidence === "high" ? "medium" : ownership.confidence,
      message: `Class "${ownership.className}" is only used by ${component.componentName}, but its stylesheet is not colocated with that component by the supported conventions.`,
      subject: {
        kind: "class-definition",
        id: ownership.classDefinitionId,
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
          kind: "component",
          id: component.id,
        },
        {
          kind: "stylesheet",
          id: stylesheet.id,
        },
      ],
      traces: buildNotColocatedTraces({
        ownership,
        componentName: component.componentName,
        stylesheetFilePath: stylesheet.filePath,
      }),
      data: {
        className: ownership.className,
        componentId: component.id,
        componentName: component.componentName,
        componentFilePath: component.filePath,
        stylesheetId: stylesheet.id,
        stylesheetFilePath: stylesheet.filePath,
        ownerCandidateReasons: ownership.ownerCandidates.flatMap((candidate) => candidate.reasons),
      },
    });
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function hasColocationEvidence(
  ownership: RuleContext["analysis"]["entities"]["classOwnership"][number],
  componentId: string,
): boolean {
  return ownership.ownerCandidates.some(
    (candidate) =>
      candidate.kind === "component" &&
      candidate.id === componentId &&
      candidate.reasons.some((reason) => COLOCATION_REASONS.has(reason)),
  );
}

function buildNotColocatedTraces(input: {
  ownership: RuleContext["analysis"]["entities"]["classOwnership"][number];
  componentName: string;
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:single-component-style-not-colocated:${input.ownership.id}`,
      category: "rule-evaluation",
      summary: `class "${input.ownership.className}" is consumed by one component without colocation evidence`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: 1,
            startColumn: 1,
          }
        : undefined,
      children: input.ownership.traces,
      metadata: {
        ruleId: "single-component-style-not-colocated",
        className: input.ownership.className,
        componentName: input.componentName,
        ownershipId: input.ownership.id,
      },
    },
  ];
}
