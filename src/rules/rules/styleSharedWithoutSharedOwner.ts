import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import { isIntentionallyBroadStylesheetPath } from "./ownershipRuleUtils.js";

export const styleSharedWithoutSharedOwnerRule: RuleDefinition = {
  id: "style-shared-without-shared-owner",
  run(context) {
    return runStyleSharedWithoutSharedOwnerRule(context);
  },
};

function runStyleSharedWithoutSharedOwnerRule(context: RuleContext): UnresolvedFinding[] {
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
      ownership.consumerSummary.consumerComponentIds.length < 2 ||
      hasHighConfidenceComponentOwner(ownership) ||
      isIntentionallyBroadStylesheetPath(stylesheet.filePath)
    ) {
      continue;
    }

    const consumerComponents = ownership.consumerSummary.consumerComponentIds
      .map((componentId) => context.analysis.indexes.componentsById.get(componentId))
      .filter((component): component is NonNullable<typeof component> => Boolean(component));
    if (consumerComponents.length < 2) {
      continue;
    }

    findings.push({
      id: `style-shared-without-shared-owner:${ownership.id}`,
      ruleId: "style-shared-without-shared-owner",
      confidence: "medium",
      message: `Class "${ownership.className}" is used by multiple components, but its stylesheet does not look like an intentionally broad style owner.`,
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
          kind: "stylesheet",
          id: stylesheet.id,
        },
        ...consumerComponents.map((component) => ({
          kind: "component" as const,
          id: component.id,
        })),
      ],
      traces: buildSharedWithoutOwnerTraces({
        ownership,
        componentNames: consumerComponents.map((component) => component.componentName),
        stylesheetFilePath: stylesheet.filePath,
      }),
      data: {
        className: ownership.className,
        componentIds: consumerComponents.map((component) => component.id),
        componentNames: consumerComponents.map((component) => component.componentName),
        componentFilePaths: consumerComponents.map((component) => component.filePath),
        stylesheetId: stylesheet.id,
        stylesheetFilePath: stylesheet.filePath,
        consumerComponentCount: consumerComponents.length,
      },
    });
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function hasHighConfidenceComponentOwner(
  ownership: RuleContext["analysis"]["entities"]["classOwnership"][number],
): boolean {
  return ownership.ownerCandidates.some(
    (candidate) =>
      candidate.kind === "component" &&
      candidate.confidence === "high" &&
      candidate.reasons.includes("single-importing-component"),
  );
}

function buildSharedWithoutOwnerTraces(input: {
  ownership: RuleContext["analysis"]["entities"]["classOwnership"][number];
  componentNames: string[];
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:style-shared-without-shared-owner:${input.ownership.id}`,
      category: "rule-evaluation",
      summary: `class "${input.ownership.className}" is consumed by multiple components without broad-owner path evidence`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: 1,
            startColumn: 1,
          }
        : undefined,
      children: input.ownership.traces,
      metadata: {
        ruleId: "style-shared-without-shared-owner",
        className: input.ownership.className,
        componentNames: input.componentNames,
        ownershipId: input.ownership.id,
      },
    },
  ];
}
