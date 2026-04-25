import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import { isIntentionallyBroadStylesheetPath } from "./ownershipRuleUtils.js";

export const styleUsedOutsideOwnerRule: RuleDefinition = {
  id: "style-used-outside-owner",
  run(context) {
    return runStyleUsedOutsideOwnerRule(context);
  },
};

function runStyleUsedOutsideOwnerRule(context: RuleContext): UnresolvedFinding[] {
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
      isIntentionallyBroadStylesheetPath(stylesheet.filePath)
    ) {
      continue;
    }

    const ownerCandidate = ownership.ownerCandidates.find(
      (candidate) =>
        candidate.kind === "component" &&
        candidate.confidence === "high" &&
        candidate.id &&
        candidate.reasons.includes("single-importing-component"),
    );
    if (!ownerCandidate?.id) {
      continue;
    }

    const ownerComponent = context.analysis.indexes.componentsById.get(ownerCandidate.id);
    if (!ownerComponent) {
      continue;
    }

    const outsideConsumerIds = ownership.consumerSummary.consumerComponentIds.filter(
      (componentId) => componentId !== ownerComponent.id,
    );
    for (const consumerId of outsideConsumerIds) {
      const consumerComponent = context.analysis.indexes.componentsById.get(consumerId);
      if (!consumerComponent) {
        continue;
      }

      findings.push({
        id: `style-used-outside-owner:${ownership.id}:${consumerComponent.id}`,
        ruleId: "style-used-outside-owner",
        confidence: "high",
        message: `Class "${ownership.className}" belongs to ${ownerComponent.componentName}'s stylesheet, but is used by ${consumerComponent.componentName}.`,
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
            id: ownerComponent.id,
          },
          {
            kind: "component",
            id: consumerComponent.id,
          },
          {
            kind: "stylesheet",
            id: stylesheet.id,
          },
        ],
        traces: buildOutsideOwnerTraces({
          ownership,
          ownerName: ownerComponent.componentName,
          consumerName: consumerComponent.componentName,
          stylesheetFilePath: stylesheet.filePath,
        }),
        data: {
          className: ownership.className,
          ownerComponentId: ownerComponent.id,
          ownerComponentName: ownerComponent.componentName,
          ownerComponentFilePath: ownerComponent.filePath,
          consumerComponentId: consumerComponent.id,
          consumerComponentName: consumerComponent.componentName,
          consumerComponentFilePath: consumerComponent.filePath,
          stylesheetId: stylesheet.id,
          stylesheetFilePath: stylesheet.filePath,
          ownerCandidateReasons: ownerCandidate.reasons,
        },
      });
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildOutsideOwnerTraces(input: {
  ownership: RuleContext["analysis"]["entities"]["classOwnership"][number];
  ownerName: string;
  consumerName: string;
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:style-used-outside-owner:${input.ownership.id}:${input.consumerName}`,
      category: "rule-evaluation",
      summary: `class "${input.ownership.className}" has a single importing owner but is consumed by another component`,
      anchor: input.stylesheetFilePath
        ? {
            filePath: input.stylesheetFilePath,
            startLine: 1,
            startColumn: 1,
          }
        : undefined,
      children: input.ownership.traces,
      metadata: {
        ruleId: "style-used-outside-owner",
        className: input.ownership.className,
        ownerName: input.ownerName,
        consumerName: input.consumerName,
        ownershipId: input.ownership.id,
      },
    },
  ];
}
