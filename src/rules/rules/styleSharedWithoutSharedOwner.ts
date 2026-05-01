import type {
  AnalysisTrace,
  ComponentAnalysis,
  SourceAnchor,
} from "../../static-analysis-engine/index.js";
import { getClassDefinitionById, getComponentById, getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  getClassOwnershipEvidence,
  hasPrivateComponentOwnerEvidence,
  isIntentionallySharedStylesheetForConsumers,
  type RuleClassOwnershipEvidence,
} from "./ownershipRuleUtils.js";

export const styleSharedWithoutSharedOwnerRule: RuleDefinition = {
  id: "style-shared-without-shared-owner",
  run(context) {
    return runStyleSharedWithoutSharedOwnerRule(context);
  },
};

function runStyleSharedWithoutSharedOwnerRule(context: RuleContext): UnresolvedFinding[] {
  const groups = new Map<string, SharedWithoutOwnerFindingGroup>();

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
      stylesheet.origin !== "project-css" ||
      ownership.consumerSummary.consumerComponentIds.length < 2 ||
      hasPrivateComponentOwnerEvidence({ ownerCandidates: ownership.ownerCandidates })
    ) {
      continue;
    }

    const consumerComponents = ownership.consumerSummary.consumerComponentIds
      .map((componentId) => getComponentById(context.analysisEvidence, componentId))
      .filter((component): component is NonNullable<typeof component> => Boolean(component));
    if (consumerComponents.length < 2) {
      continue;
    }

    if (
      isIntentionallySharedStylesheetForConsumers({
        stylesheetFilePath: stylesheet.filePath,
        consumerComponentNames: consumerComponents.map((component) => component.componentName),
        sharedCssPatterns: context.config.ownership.sharedCss,
      })
    ) {
      continue;
    }

    const sortedConsumerComponents = [...consumerComponents].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const key = [
      "style-shared-without-shared-owner",
      ownership.className,
      stylesheet.id,
      sortedConsumerComponents.map((component) => component.id).join(","),
    ].join(":");
    const group =
      groups.get(key) ??
      createSharedWithoutOwnerFindingGroup({
        key,
        ownership,
        consumerComponents: sortedConsumerComponents,
        stylesheetId: stylesheet.id,
        stylesheetFilePath: stylesheet.filePath,
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
    if (context.includeTraces !== false) {
      group.traces.push(
        ...buildSharedWithoutOwnerTraces({
          ownership,
          componentNames: sortedConsumerComponents.map((component) => component.componentName),
          stylesheetFilePath: stylesheet.filePath,
        }),
      );
    }

    groups.set(key, group);
  }

  return [...groups.values()]
    .map(buildSharedWithoutOwnerFinding)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildSharedWithoutOwnerTraces(input: {
  ownership: RuleClassOwnershipEvidence;
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

type ClassOwnership = RuleClassOwnershipEvidence;

type SharedWithoutOwnerFindingGroup = {
  key: string;
  className: string;
  consumerComponents: ComponentAnalysis[];
  stylesheetId: string;
  stylesheetFilePath?: string;
  subjectDefinitionId: string;
  definitionIds: string[];
  definitionLocations: SourceAnchor[];
  traces: AnalysisTrace[];
};

function createSharedWithoutOwnerFindingGroup(input: {
  key: string;
  ownership: ClassOwnership;
  consumerComponents: ComponentAnalysis[];
  stylesheetId: string;
  stylesheetFilePath?: string;
}): SharedWithoutOwnerFindingGroup {
  return {
    key: input.key,
    className: input.ownership.className,
    consumerComponents: input.consumerComponents,
    stylesheetId: input.stylesheetId,
    stylesheetFilePath: input.stylesheetFilePath,
    subjectDefinitionId: input.ownership.classDefinitionId,
    definitionIds: [],
    definitionLocations: [],
    traces: [],
  };
}

function buildSharedWithoutOwnerFinding(group: SharedWithoutOwnerFindingGroup): UnresolvedFinding {
  const definitionLocations = sortLocations(deduplicateLocations(group.definitionLocations));
  const subjectDefinitionId = group.definitionIds[0] ?? group.subjectDefinitionId;
  const consumerComponents = [...group.consumerComponents].sort((left, right) =>
    left.componentName.localeCompare(right.componentName),
  );

  return {
    id: group.key,
    ruleId: "style-shared-without-shared-owner",
    confidence: "medium",
    message: buildSharedWithoutOwnerMessage({
      className: group.className,
      componentNames: consumerComponents.map((component) => component.componentName),
      definitionCount: definitionLocations.length,
    }),
    subject: {
      kind: "class-definition",
      id: subjectDefinitionId,
    },
    location: definitionLocations[0],
    evidence: [
      {
        kind: "stylesheet",
        id: group.stylesheetId,
      },
      ...consumerComponents.map((component) => ({
        kind: "component" as const,
        id: component.id,
      })),
    ],
    traces: group.traces,
    data: {
      className: group.className,
      componentIds: consumerComponents.map((component) => component.id),
      componentNames: consumerComponents.map((component) => component.componentName),
      componentFilePaths: consumerComponents.map((component) => component.filePath),
      stylesheetId: group.stylesheetId,
      stylesheetFilePath: group.stylesheetFilePath,
      consumerComponentCount: consumerComponents.length,
      definitionCount: definitionLocations.length,
      definitionLocations,
    },
  };
}

function buildSharedWithoutOwnerMessage(input: {
  className: string;
  componentNames: string[];
  definitionCount: number;
}): string {
  const definitionText =
    input.definitionCount > 1
      ? `. The class is defined in ${input.definitionCount} matching selector blocks`
      : `: ${formatNameList(input.componentNames)}`;

  return `Class "${input.className}" is used by ${input.componentNames.length} components, but its stylesheet does not look like an intentionally shared style owner${definitionText}.`;
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
