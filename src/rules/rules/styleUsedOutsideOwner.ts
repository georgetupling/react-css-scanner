import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  findPrivateComponentOwnerCandidate,
  isContextualPrimitiveOverrideClass,
  isGenericStateClassToken,
  isOwnerFamilyConsumer,
} from "./ownershipRuleUtils.js";

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
      stylesheet.origin !== "project-css"
    ) {
      continue;
    }

    const ownerCandidate = findPrivateComponentOwnerCandidate(ownership.ownerCandidates);
    if (!ownerCandidate?.id) {
      continue;
    }

    if (isGenericStateClassToken(ownership.className)) {
      continue;
    }

    const ownerComponent = context.analysis.indexes.componentsById.get(ownerCandidate.id);
    if (!ownerComponent) {
      continue;
    }

    if (
      isContextualPrimitiveOverrideClass({
        className: ownership.className,
        selectorKind: definition.selectorKind,
        contextClassNames: definition.sourceDefinition.selectorBranch.contextClassNames,
        ownerComponentName: ownerComponent.componentName,
        stylesheetFilePath: stylesheet.filePath,
      })
    ) {
      continue;
    }

    const outsideConsumerIds = ownership.consumerSummary.consumerComponentIds.filter(
      (componentId) => {
        if (componentId === ownerComponent.id) {
          return false;
        }

        const consumerComponent = context.analysis.indexes.componentsById.get(componentId);
        return !isOwnerFamilyConsumer({
          ownerComponentFilePath: ownerComponent.filePath,
          consumerComponentFilePath: consumerComponent?.filePath,
          stylesheetFilePath: stylesheet.filePath,
        });
      },
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
        traces:
          context.includeTraces === false
            ? []
            : buildOutsideOwnerTraces({
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
