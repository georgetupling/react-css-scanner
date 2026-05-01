import type {
  AnalysisTrace,
  ComponentAnalysis,
  SourceAnchor,
} from "../../static-analysis-engine/index.js";
import { getClassDefinitionById, getComponentById, getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  getClassOwnershipEvidence,
  getOwnerCandidateId,
  getOwnerCandidateKind,
  isIntentionallySharedStylesheetPath,
  type RuleClassOwnershipEvidence,
} from "./ownershipRuleUtils.js";

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
  const groups = new Map<string, NotColocatedFindingGroup>();

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
      ownership.consumerSummary.consumerComponentIds.length !== 1
    ) {
      continue;
    }

    const componentId = ownership.consumerSummary.consumerComponentIds[0];
    const component = getComponentById(context.analysisEvidence, componentId);
    if (!component || hasColocationEvidence(ownership, componentId)) {
      continue;
    }

    if (
      isIntentionallySharedStylesheetPath({
        filePath: stylesheet.filePath,
        sharedCssPatterns: context.config.ownership.sharedCss,
      })
    ) {
      continue;
    }

    const key = [
      "single-component-style-not-colocated",
      ownership.className,
      stylesheet.id,
      component.id,
    ].join(":");
    const group =
      groups.get(key) ??
      createNotColocatedFindingGroup({
        key,
        ownership,
        component,
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
    group.ownerCandidateReasons.push(
      ...ownership.ownerCandidates.flatMap((candidate) => candidate.reasons),
    );
    if (context.includeTraces !== false) {
      group.traces.push(
        ...buildNotColocatedTraces({
          ownership,
          componentName: component.componentName,
          stylesheetFilePath: stylesheet.filePath,
        }),
      );
    }

    groups.set(key, group);
  }

  return [...groups.values()]
    .map(buildNotColocatedFinding)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function hasColocationEvidence(
  ownership: RuleClassOwnershipEvidence,
  componentId: string,
): boolean {
  return ownership.ownerCandidates.some(
    (candidate) =>
      getOwnerCandidateKind(candidate) === "component" &&
      getOwnerCandidateId(candidate) === componentId &&
      candidate.reasons.some((reason) => COLOCATION_REASONS.has(reason)),
  );
}

type ClassOwnership = RuleClassOwnershipEvidence;

type NotColocatedFindingGroup = {
  key: string;
  className: string;
  component: ComponentAnalysis;
  stylesheetId: string;
  stylesheetFilePath?: string;
  confidence: ClassOwnership["confidence"];
  subjectDefinitionId: string;
  definitionIds: string[];
  definitionLocations: SourceAnchor[];
  ownerCandidateReasons: string[];
  traces: AnalysisTrace[];
};

function createNotColocatedFindingGroup(input: {
  key: string;
  ownership: ClassOwnership;
  component: ComponentAnalysis;
  stylesheetId: string;
  stylesheetFilePath?: string;
}): NotColocatedFindingGroup {
  return {
    key: input.key,
    className: input.ownership.className,
    component: input.component,
    stylesheetId: input.stylesheetId,
    stylesheetFilePath: input.stylesheetFilePath,
    confidence: input.ownership.confidence,
    subjectDefinitionId: input.ownership.classDefinitionId,
    definitionIds: [],
    definitionLocations: [],
    ownerCandidateReasons: [],
    traces: [],
  };
}

function buildNotColocatedFinding(group: NotColocatedFindingGroup): UnresolvedFinding {
  const definitionLocations = sortLocations(deduplicateLocations(group.definitionLocations));
  const subjectDefinitionId = group.definitionIds[0] ?? group.subjectDefinitionId;
  const ownerCandidateReasons = [...new Set(group.ownerCandidateReasons)].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    id: group.key,
    ruleId: "single-component-style-not-colocated",
    confidence: group.confidence === "high" ? "medium" : group.confidence,
    message: buildNotColocatedMessage({
      className: group.className,
      componentName: group.component.componentName,
      definitionCount: definitionLocations.length,
    }),
    subject: {
      kind: "class-definition",
      id: subjectDefinitionId,
    },
    location: definitionLocations[0],
    evidence: [
      {
        kind: "component",
        id: group.component.id,
      },
      {
        kind: "stylesheet",
        id: group.stylesheetId,
      },
    ],
    traces: group.traces,
    data: {
      className: group.className,
      componentId: group.component.id,
      componentName: group.component.componentName,
      componentFilePath: group.component.filePath,
      stylesheetId: group.stylesheetId,
      stylesheetFilePath: group.stylesheetFilePath,
      definitionCount: definitionLocations.length,
      definitionLocations,
      ownerCandidateReasons,
    },
  };
}

function buildNotColocatedMessage(input: {
  className: string;
  componentName: string;
  definitionCount: number;
}): string {
  const definitionText =
    input.definitionCount > 1
      ? ` The class is defined in ${input.definitionCount} matching selector blocks.`
      : "";

  return `Class "${input.className}" is only used by ${input.componentName}, but its stylesheet is not colocated with that component by the supported conventions.${definitionText}`;
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

function buildNotColocatedTraces(input: {
  ownership: RuleClassOwnershipEvidence;
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
