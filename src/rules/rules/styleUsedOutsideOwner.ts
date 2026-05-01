import type {
  AnalysisTrace,
  ComponentAnalysis,
  SourceAnchor,
} from "../../static-analysis-engine/index.js";
import { getClassDefinitionById, getComponentById, getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  findPrivateComponentOwnerCandidate,
  getClassOwnershipEvidence,
  getOwnerCandidateId,
  isContextualPrimitiveOverrideClass,
  isGenericStateClassToken,
  isOwnerFamilyConsumer,
  type RuleClassOwnershipEvidence,
} from "./ownershipRuleUtils.js";

export const styleUsedOutsideOwnerRule: RuleDefinition = {
  id: "style-used-outside-owner",
  run(context) {
    return runStyleUsedOutsideOwnerRule(context);
  },
};

function runStyleUsedOutsideOwnerRule(context: RuleContext): UnresolvedFinding[] {
  const groups = new Map<string, OutsideOwnerFindingGroup>();

  for (const ownership of getClassOwnershipEvidence(context)) {
    const definition = getClassDefinitionById(
      context.analysisEvidence,
      ownership.classDefinitionId,
    );
    const stylesheet = getStylesheetById(context.analysisEvidence, ownership.stylesheetId);
    if (
      !definition ||
      !stylesheet ||
      definition.isCssModule ||
      stylesheet.origin !== "project-css"
    ) {
      continue;
    }

    const ownerCandidate = findPrivateComponentOwnerCandidate(ownership.ownerCandidates);
    if (!ownerCandidate) {
      continue;
    }

    const ownerComponentId = getOwnerCandidateId(ownerCandidate);
    if (!ownerComponentId) {
      continue;
    }

    if (isGenericStateClassToken(ownership.className)) {
      continue;
    }

    const ownerComponent = getComponentById(context.analysisEvidence, ownerComponentId);
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

        const consumerComponent = getComponentById(context.analysisEvidence, componentId);
        return !isOwnerFamilyConsumer({
          ownerComponentFilePath: ownerComponent.filePath,
          consumerComponentFilePath: consumerComponent?.filePath,
          stylesheetFilePath: stylesheet.filePath,
        });
      },
    );
    const outsideConsumerComponents = outsideConsumerIds
      .map((consumerId) => getComponentById(context.analysisEvidence, consumerId))
      .filter((component): component is ComponentAnalysis => Boolean(component));
    if (outsideConsumerComponents.length === 0) {
      continue;
    }

    const key = [
      "style-used-outside-owner",
      ownership.className,
      stylesheet.id,
      ownerComponent.id,
    ].join(":");
    const group =
      groups.get(key) ??
      createOutsideOwnerFindingGroup({
        key,
        ownership,
        ownerComponent,
        stylesheetId: stylesheet.id,
        stylesheetFilePath: stylesheet.filePath,
        ownerCandidateReasons: ownerCandidate.reasons,
      });

    const location = stylesheet.filePath
      ? {
          filePath: stylesheet.filePath,
          startLine: definition.line,
          startColumn: 1,
        }
      : undefined;
    group.definitionIds.push(ownership.classDefinitionId);
    if (location) {
      group.definitionLocations.push(location);
    }
    group.referenceIds.push(...ownership.consumerSummary.referenceIds);
    for (const consumerComponent of outsideConsumerComponents) {
      group.outsideConsumers.set(consumerComponent.id, consumerComponent);
    }
    if (context.includeTraces !== false) {
      group.traces.push(
        ...buildOutsideOwnerTraces({
          ownership,
          ownerName: ownerComponent.componentName,
          consumerNames: outsideConsumerComponents.map((component) => component.componentName),
          stylesheetFilePath: stylesheet.filePath,
        }),
      );
    }

    groups.set(key, group);
  }

  return [...groups.values()]
    .map(buildOutsideOwnerFinding)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildOutsideOwnerTraces(input: {
  ownership: RuleClassOwnershipEvidence;
  ownerName: string;
  consumerNames: string[];
  stylesheetFilePath?: string;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:style-used-outside-owner:${input.ownership.id}`,
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
        consumerNames: input.consumerNames,
        ownershipId: input.ownership.id,
      },
    },
  ];
}

type ClassOwnership = RuleClassOwnershipEvidence;

type OutsideOwnerFindingGroup = {
  key: string;
  className: string;
  ownerComponent: ComponentAnalysis;
  stylesheetId: string;
  stylesheetFilePath?: string;
  subjectDefinitionId: string;
  definitionIds: string[];
  definitionLocations: SourceAnchor[];
  outsideConsumers: Map<string, ComponentAnalysis>;
  referenceIds: string[];
  ownerCandidateReasons: string[];
  traces: AnalysisTrace[];
};

function createOutsideOwnerFindingGroup(input: {
  key: string;
  ownership: ClassOwnership;
  ownerComponent: ComponentAnalysis;
  stylesheetId: string;
  stylesheetFilePath?: string;
  ownerCandidateReasons: string[];
}): OutsideOwnerFindingGroup {
  return {
    key: input.key,
    className: input.ownership.className,
    ownerComponent: input.ownerComponent,
    stylesheetId: input.stylesheetId,
    stylesheetFilePath: input.stylesheetFilePath,
    subjectDefinitionId: input.ownership.classDefinitionId,
    definitionIds: [],
    definitionLocations: [],
    outsideConsumers: new Map(),
    referenceIds: [],
    ownerCandidateReasons: input.ownerCandidateReasons,
    traces: [],
  };
}

function buildOutsideOwnerFinding(group: OutsideOwnerFindingGroup): UnresolvedFinding {
  const outsideConsumers = [...group.outsideConsumers.values()].sort((left, right) =>
    left.componentName.localeCompare(right.componentName),
  );
  const definitionLocations = sortLocations(deduplicateLocations(group.definitionLocations));
  const primaryLocation = definitionLocations[0];
  const subjectDefinitionId = group.definitionIds[0] ?? group.subjectDefinitionId;

  return {
    id: group.key,
    ruleId: "style-used-outside-owner",
    confidence: "high",
    message: buildOutsideOwnerMessage({
      className: group.className,
      ownerComponentName: group.ownerComponent.componentName,
      outsideConsumerNames: outsideConsumers.map((component) => component.componentName),
      definitionCount: definitionLocations.length,
    }),
    subject: {
      kind: "class-definition",
      id: subjectDefinitionId,
    },
    location: primaryLocation,
    evidence: [
      {
        kind: "component",
        id: group.ownerComponent.id,
      },
      ...outsideConsumers.map((component) => ({
        kind: "component" as const,
        id: component.id,
      })),
      {
        kind: "stylesheet",
        id: group.stylesheetId,
      },
    ],
    traces: group.traces,
    data: {
      className: group.className,
      ownerComponentId: group.ownerComponent.id,
      ownerComponentName: group.ownerComponent.componentName,
      ownerComponentFilePath: group.ownerComponent.filePath,
      consumerComponentId: outsideConsumers[0]?.id,
      consumerComponentName: outsideConsumers[0]?.componentName,
      consumerComponentFilePath: outsideConsumers[0]?.filePath,
      outsideConsumerComponentCount: outsideConsumers.length,
      outsideConsumerComponentIds: outsideConsumers.map((component) => component.id),
      outsideConsumerComponentNames: outsideConsumers.map((component) => component.componentName),
      outsideConsumerComponentFilePaths: outsideConsumers.map((component) => component.filePath),
      outsideReferenceCount: new Set(group.referenceIds).size,
      stylesheetId: group.stylesheetId,
      stylesheetFilePath: group.stylesheetFilePath,
      definitionCount: definitionLocations.length,
      definitionLocations,
      ownerCandidateReasons: group.ownerCandidateReasons,
    },
  };
}

function buildOutsideOwnerMessage(input: {
  className: string;
  ownerComponentName: string;
  outsideConsumerNames: string[];
  definitionCount: number;
}): string {
  const consumerText =
    input.outsideConsumerNames.length === 1
      ? input.outsideConsumerNames[0]
      : `${input.outsideConsumerNames.length} components: ${formatNameList(input.outsideConsumerNames)}`;
  const definitionText =
    input.definitionCount > 1
      ? ` The class is defined in ${input.definitionCount} matching selector blocks.`
      : "";

  return `Class "${input.className}" appears to belong to ${input.ownerComponentName}'s stylesheet, but it is used outside that owner by ${consumerText}.${definitionText}`;
}

function formatNameList(names: string[]): string {
  if (names.length <= 4) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
}

function deduplicateLocations(locations: SourceAnchor[]): SourceAnchor[] {
  const seen = new Set<string>();
  const result: SourceAnchor[] = [];
  for (const location of locations) {
    const key = `${location.filePath}:${location.startLine}:${location.startColumn}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(location);
    }
  }

  return result;
}

function sortLocations(locations: SourceAnchor[]): SourceAnchor[] {
  return [...locations].sort((left, right) => {
    const fileCompare = left.filePath.localeCompare(right.filePath);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }

    return left.startColumn - right.startColumn;
  });
}
