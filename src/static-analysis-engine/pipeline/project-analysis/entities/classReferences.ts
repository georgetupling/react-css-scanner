import type { ClassExpressionSummary } from "../../symbolic-evaluation/class-values/types.js";
import { toClassExpressionSummary } from "../../symbolic-evaluation/adapters/classExpressionSummary.js";
import type { CanonicalClassExpression } from "../../symbolic-evaluation/types.js";
import type {
  EmissionSite,
  PlacementCondition,
  RenderModel,
} from "../../render-structure/types.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import type {
  ClassReferenceAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  StaticallySkippedClassReferenceAnalysis,
} from "../types.js";
import {
  collectReferenceClassNames,
  collectSkippedReferenceClassNames,
  compareAnchors,
  compareById,
  createAnchorId,
  createPathId,
  getReferenceConfidence,
  getReferenceExpressionKind,
  normalizeAnchor,
  normalizeProjectPath,
  pushMapValue,
  sortIndexValues,
} from "../internal/shared.js";

type StaticallySkippedPlacementCondition = PlacementCondition & {
  kind: "statically-skipped-branch";
  sourceLocation: SourceAnchor;
  branch: "when-true" | "when-false";
  reason: "condition-resolved-true" | "condition-resolved-false" | "expression-resolved-nullish";
};

export function buildClassReferences(input: {
  renderModel: RenderModel;
  symbolicEvaluation: ProjectAnalysisBuildInput["symbolicEvaluation"];
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): ClassReferenceAnalysis[] {
  if (!input.symbolicEvaluation) {
    return [];
  }

  const references = buildClassReferencesFromEmissionSites({
    renderModel: input.renderModel,
    symbolicEvaluation: input.symbolicEvaluation,
    factGraph: input.factGraph,
    indexes: input.indexes,
    includeTraces: input.includeTraces,
  });

  sortIndexValues(input.indexes.referencesBySourceFileId);
  sortIndexValues(input.indexes.referencesByClassName);
  return references;
}

function buildClassReferencesFromEmissionSites(input: {
  renderModel: RenderModel;
  symbolicEvaluation: NonNullable<ProjectAnalysisBuildInput["symbolicEvaluation"]>;
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): ClassReferenceAnalysis[] {
  const expressionsById = new Map(
    input.symbolicEvaluation.evaluatedExpressions.classExpressions.map((expression) => [
      expression.id,
      expression,
    ]),
  );
  const references: ClassReferenceAnalysis[] = [];
  const emittedReferenceKeys = new Set<string>();

  for (const emissionSite of sortEmissionSites(input.renderModel.emissionSites)) {
    const expression = expressionsById.get(emissionSite.classExpressionId);
    if (!expression) {
      continue;
    }
    const dedupeKey = createEmissionReferenceDedupeKey({
      emissionSite,
      expression,
      factGraph: input.factGraph,
      indexes: input.indexes,
    });
    if (emittedReferenceKeys.has(dedupeKey)) {
      continue;
    }
    emittedReferenceKeys.add(dedupeKey);

    references.push(
      buildClassReferenceFromEmissionSite({
        emissionSite,
        expression,
        factGraph: input.factGraph,
        indexes: input.indexes,
        includeTraces: input.includeTraces,
        index: references.length,
      }),
    );
  }

  const emittedExpressionIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionId),
  );
  const emittedSiteNodeIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionSiteNodeId),
  );
  const skippedConditions = input.renderModel.placementConditions
    .filter(isStaticallySkippedCondition)
    .sort(comparePlacementConditions);
  for (const expression of input.symbolicEvaluation.evaluatedExpressions.classExpressions) {
    if (
      emittedExpressionIds.has(expression.id) ||
      emittedSiteNodeIds.has(expression.classExpressionSiteNodeId) ||
      isExpressionInsideSkippedCondition(expression, skippedConditions) ||
      !shouldProjectCanonicalClassExpression(expression)
    ) {
      continue;
    }

    if (expression.classExpressionSiteKind !== "runtime-dom-class") {
      continue;
    }

    references.push(
      buildSymbolicClassReference({
        expression,
        classExpression: toClassExpressionSummary(expression),
        origin:
          expression.classExpressionSiteKind === "runtime-dom-class" ? "runtime-dom" : "render-ir",
        factGraph: input.factGraph,
        indexes: input.indexes,
        includeTraces: input.includeTraces,
        index: references.length,
      }),
    );
  }

  return references.sort(compareById);
}

function buildClassReferenceFromEmissionSite(input: {
  emissionSite: EmissionSite;
  expression: CanonicalClassExpression;
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
  index: number;
}): ClassReferenceAnalysis {
  const classExpression = toEmissionSiteClassExpressionSummary(
    input.emissionSite,
    input.expression,
  );
  const site = input.factGraph?.graph.indexes.nodesById.get(
    input.expression.classExpressionSiteNodeId,
  );
  const sourceLocation = resolveReferenceSourceLocation(classExpression, input.emissionSite);
  const sourceSite = findClassExpressionSiteAtLocation(input.factGraph, sourceLocation);
  const sourceFileId =
    input.indexes.sourceFileIdByPath.get(sourceLocation.filePath) ??
    createPathId("source", sourceLocation.filePath);
  const emittedByComponentId = projectComponentNodeId(
    input.emissionSite.emittingComponentNodeId,
    input,
  );
  const sourceComponentId =
    projectComponentNodeId(sourceSite?.emittingComponentNodeId, input) ??
    projectComponentAtLocation(sourceLocation, input);
  const suppliedByComponentId =
    sourceComponentId ??
    projectComponentNodeId(input.emissionSite.suppliedByComponentNodeId, input);
  const id = createAnchorId("class-reference", sourceLocation, input.index);
  const reference: ClassReferenceAnalysis = {
    id,
    sourceFileId,
    componentId: sourceComponentId ?? suppliedByComponentId ?? emittedByComponentId,
    suppliedByComponentId,
    emittedByComponentId,
    classNameComponentIds: buildEmissionClassNameComponentIds(input),
    location: sourceLocation,
    ...(input.emissionSite.emittedElementLocation
      ? { emittedElementLocation: normalizeAnchor(input.emissionSite.emittedElementLocation) }
      : {}),
    ...(input.emissionSite.placementLocation
      ? { placementLocation: normalizeAnchor(input.emissionSite.placementLocation) }
      : {}),
    origin: "render-ir",
    ...(site?.kind === "class-expression-site" && site.runtimeDomLibraryHint
      ? { runtimeLibraryHint: site.runtimeDomLibraryHint }
      : {}),
    expressionKind: getReferenceExpressionKind(classExpression),
    rawExpressionText: sourceSite?.rawExpressionText ?? input.expression.rawExpressionText,
    definiteClassNames: [...classExpression.classes.definite],
    possibleClassNames: [...classExpression.classes.possible],
    unknownDynamic: classExpression.classes.unknownDynamic,
    confidence: getReferenceConfidence(classExpression),
    traces: input.includeTraces
      ? buildEmissionSiteClassReferenceTraces({
          emissionSite: input.emissionSite,
          expression: input.expression,
          classExpression,
        })
      : [],
    sourceSummary: classExpression,
  };

  pushClassReferenceIndexes(input.indexes, reference);
  return reference;
}

function buildSymbolicClassReference(input: {
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  origin: ClassReferenceAnalysis["origin"];
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
  index: number;
}): ClassReferenceAnalysis {
  const site = input.factGraph?.graph.indexes.nodesById.get(
    input.expression.classExpressionSiteNodeId,
  );
  const filePath = normalizeProjectPath(input.expression.filePath);
  const sourceFileId =
    input.indexes.sourceFileIdByPath.get(filePath) ?? createPathId("source", filePath);
  const idPrefix =
    input.origin === "runtime-dom"
      ? "runtime-dom-class-reference"
      : "symbolic-render-class-reference";
  const id = createAnchorId(idPrefix, input.expression.location, input.index);
  const componentId = projectComponentNodeId(input.expression.emittingComponentNodeId, input);
  const reference: ClassReferenceAnalysis = {
    id,
    sourceFileId,
    componentId,
    location: normalizeAnchor(input.expression.location),
    origin: input.origin,
    ...(site?.kind === "class-expression-site" && site.runtimeDomLibraryHint
      ? { runtimeLibraryHint: site.runtimeDomLibraryHint }
      : {}),
    expressionKind: getReferenceExpressionKind(input.classExpression),
    rawExpressionText: input.expression.rawExpressionText,
    definiteClassNames: [...input.classExpression.classes.definite],
    possibleClassNames: [...input.classExpression.classes.possible],
    unknownDynamic: input.classExpression.classes.unknownDynamic,
    confidence: getReferenceConfidence(input.classExpression),
    traces: input.includeTraces
      ? buildCanonicalClassReferenceTraces({
          expression: input.expression,
          classExpression: input.classExpression,
          origin: input.origin,
        })
      : [],
    sourceSummary: input.classExpression,
  };

  pushClassReferenceIndexes(input.indexes, reference);
  return reference;
}

export function buildStaticallySkippedClassReferences(input: {
  renderModel: RenderModel;
  symbolicEvaluation: ProjectAnalysisBuildInput["symbolicEvaluation"];
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): StaticallySkippedClassReferenceAnalysis[] {
  if (!input.symbolicEvaluation || !input.factGraph) {
    return [];
  }

  const emittedSiteNodeIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionSiteNodeId),
  );
  const candidateExpressions = input.symbolicEvaluation.evaluatedExpressions.classExpressions
    .filter(
      (expression) =>
        (expression.classExpressionSiteKind === "jsx-class" ||
          expression.classExpressionSiteKind === "component-prop-class") &&
        !emittedSiteNodeIds.has(expression.classExpressionSiteNodeId) &&
        shouldProjectCanonicalClassExpression(expression),
    )
    .sort(compareCanonicalClassExpressions);
  const skippedConditions = input.renderModel.placementConditions
    .filter(isStaticallySkippedCondition)
    .sort(comparePlacementConditions);

  const references: StaticallySkippedClassReferenceAnalysis[] = [];
  const seen = new Set<string>();
  for (const condition of skippedConditions) {
    for (const expression of candidateExpressions) {
      if (
        !condition.sourceLocation ||
        !sourceAnchorContains(condition.sourceLocation, expression.location)
      ) {
        continue;
      }

      const key = `${condition.id}:${expression.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const classExpression = toClassExpressionSummary(expression);
      const filePath = normalizeProjectPath(expression.filePath);
      const sourceFileId =
        input.indexes.sourceFileIdByPath.get(filePath) ?? createPathId("source", filePath);
      const id = createAnchorId(
        "statically-skipped-class-reference",
        expression.location,
        references.length,
      );
      const componentId = projectComponentNodeId(expression.emittingComponentNodeId, input);
      const reference: StaticallySkippedClassReferenceAnalysis = {
        id,
        sourceFileId,
        componentId,
        location: normalizeAnchor(expression.location),
        branchLocation: normalizeAnchor(condition.sourceLocation),
        conditionSourceText: condition.sourceText ?? "",
        skippedBranch: condition.branch,
        reason: condition.reason,
        rawExpressionText: expression.rawExpressionText,
        definiteClassNames: [...classExpression.classes.definite],
        possibleClassNames: [...classExpression.classes.possible],
        unknownDynamic: classExpression.classes.unknownDynamic,
        confidence: getReferenceConfidence(classExpression),
        traces: input.includeTraces
          ? buildStaticallySkippedClassReferenceTraces({
              condition,
              expression,
              classExpression,
              componentId,
            })
          : [],
        sourceSummary: classExpression,
      };

      for (const className of collectSkippedReferenceClassNames(reference)) {
        pushMapValue(input.indexes.staticallySkippedReferencesByClassName, className, id);
      }
      references.push(reference);
    }
  }

  sortIndexValues(input.indexes.staticallySkippedReferencesByClassName);
  return references.sort(compareById);
}

function pushClassReferenceIndexes(
  indexes: ProjectAnalysisIndexes,
  reference: ClassReferenceAnalysis,
): void {
  pushMapValue(indexes.referencesBySourceFileId, reference.sourceFileId, reference.id);
  for (const className of collectReferenceClassNames(reference)) {
    pushMapValue(indexes.referencesByClassName, className, reference.id);
  }
}

function createEmissionReferenceDedupeKey(input: {
  emissionSite: EmissionSite;
  expression: CanonicalClassExpression;
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
}): string {
  const classExpression = toEmissionSiteClassExpressionSummary(
    input.emissionSite,
    input.expression,
  );
  const suppliedByComponentId = projectComponentNodeId(
    input.emissionSite.suppliedByComponentNodeId,
    input,
  );
  const emittedByComponentId = projectComponentNodeId(
    input.emissionSite.emittingComponentNodeId,
    input,
  );
  const classNameComponentIds = buildEmissionClassNameComponentIds(input);

  return [
    normalizeProjectPath(classExpression.sourceAnchor.filePath),
    classExpression.sourceAnchor.startLine,
    classExpression.sourceAnchor.startColumn,
    classExpression.sourceAnchor.endLine ?? "",
    classExpression.sourceAnchor.endColumn ?? "",
    classExpression.classes.definite.join(" "),
    classExpression.classes.possible.join(" "),
    classExpression.classes.unknownDynamic ? "dynamic" : "static",
    suppliedByComponentId ?? "",
    emittedByComponentId ?? "",
    serializeClassNameComponentIds(classNameComponentIds),
  ].join(":");
}

function projectComponentNodeId(
  componentNodeId: string | undefined,
  input: {
    factGraph: ProjectAnalysisBuildInput["factGraph"];
    indexes: ProjectAnalysisIndexes;
  },
): ProjectAnalysisId | undefined {
  if (!componentNodeId) {
    return undefined;
  }

  const componentNode = input.factGraph?.graph.indexes.nodesById.get(componentNodeId);
  if (componentNode?.kind === "component") {
    return input.indexes.componentIdByComponentKey.get(componentNode.componentKey);
  }

  return undefined;
}

function buildEmissionClassNameComponentIds(input: {
  emissionSite: EmissionSite;
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
}): Record<string, ProjectAnalysisId> | undefined {
  const componentIdsByClassName: Record<string, ProjectAnalysisId> = {};

  for (const provenance of input.emissionSite.tokenProvenance) {
    const sourceLocation = provenance.sourceLocation
      ? normalizeAnchor(provenance.sourceLocation)
      : undefined;
    const sourceSite = sourceLocation
      ? findClassExpressionSiteAtLocation(input.factGraph, sourceLocation)
      : undefined;
    const sourceLocationComponentId =
      projectComponentNodeId(sourceSite?.emittingComponentNodeId, input) ??
      (sourceLocation ? projectComponentAtLocation(sourceLocation, input) : undefined);
    const componentId =
      sourceLocationComponentId ??
      projectComponentNodeId(
        provenance.suppliedByComponentNodeId ??
          provenance.emittedByComponentNodeId ??
          (provenance.tokenKind === "external-class"
            ? input.emissionSite.suppliedByComponentNodeId
            : input.emissionSite.emittingComponentNodeId),
        input,
      );
    if (componentId) {
      componentIdsByClassName[provenance.token] = componentId;
    }
  }

  return Object.keys(componentIdsByClassName).length > 0 ? componentIdsByClassName : undefined;
}

function resolveReferenceSourceLocation(
  classExpression: ClassExpressionSummary,
  emissionSite: EmissionSite,
): SourceAnchor {
  const classNames = uniqueSorted([
    ...classExpression.classes.definite,
    ...classExpression.classes.possible,
  ]);
  const sourceAnchors = classNames
    .map((className) => classExpression.classNameSourceAnchors?.[className])
    .filter((anchor): anchor is SourceAnchor => Boolean(anchor))
    .map(normalizeAnchor);

  if (
    sourceAnchors.length > 0 &&
    sourceAnchors.every((anchor) => anchorsEqual(anchor, sourceAnchors[0]))
  ) {
    return sourceAnchors[0];
  }

  return normalizeAnchor(emissionSite.sourceLocation);
}

function findClassExpressionSiteAtLocation(
  factGraph: ProjectAnalysisBuildInput["factGraph"],
  location: SourceAnchor,
): { rawExpressionText: string; emittingComponentNodeId?: string } | undefined {
  return factGraph?.graph.nodes.classExpressionSites
    .filter((site) => {
      const siteLocation = normalizeAnchor(site.location);
      return (
        anchorsEqual(siteLocation, location) ||
        sourceAnchorContains(siteLocation, location) ||
        sourceAnchorContains(location, siteLocation)
      );
    })
    .sort((left, right) => anchorSpan(left.location) - anchorSpan(right.location))[0];
}

function projectComponentAtLocation(
  location: SourceAnchor,
  input: {
    factGraph: ProjectAnalysisBuildInput["factGraph"];
    indexes: ProjectAnalysisIndexes;
  },
): ProjectAnalysisId | undefined {
  const component = input.factGraph?.graph.nodes.components
    .filter((candidate) => sourceAnchorContains(candidate.location, location))
    .sort((left, right) => anchorSpan(left.location) - anchorSpan(right.location))[0];
  if (component) {
    return input.indexes.componentIdByComponentKey.get(component.componentKey);
  }

  const sameFileComponents =
    input.factGraph?.graph.nodes.components.filter(
      (candidate) =>
        normalizeProjectPath(candidate.filePath) === normalizeProjectPath(location.filePath),
    ) ?? [];
  return sameFileComponents.length === 1
    ? input.indexes.componentIdByComponentKey.get(sameFileComponents[0].componentKey)
    : undefined;
}

function anchorsEqual(left: SourceAnchor, right: SourceAnchor): boolean {
  return (
    normalizeProjectPath(left.filePath) === normalizeProjectPath(right.filePath) &&
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    (left.endLine ?? 0) === (right.endLine ?? 0) &&
    (left.endColumn ?? 0) === (right.endColumn ?? 0)
  );
}

function anchorSpan(anchor: SourceAnchor): number {
  return (
    ((anchor.endLine ?? anchor.startLine) - anchor.startLine) * 100000 +
    ((anchor.endColumn ?? anchor.startColumn) - anchor.startColumn)
  );
}

function serializeClassNameComponentIds(record: Record<string, string> | undefined): string {
  if (!record) {
    return "";
  }

  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([className, componentId]) => `${className}=${componentId}`)
    .join(",");
}

function shouldProjectCanonicalClassExpression(expression: CanonicalClassExpression): boolean {
  if (expression.classExpressionSiteKind === "css-module-member") {
    return false;
  }

  return (
    expression.tokens.some((token) => token.tokenKind !== "css-module-export") ||
    expression.unsupported.some((reason) => reason.kind !== "unsupported-css-module-access")
  );
}

function toEmissionSiteClassExpressionSummary(
  emissionSite: EmissionSite,
  expression: CanonicalClassExpression,
): ClassExpressionSummary {
  const globalTokens = emissionSite.tokens.filter(
    (token) => token.tokenKind !== "css-module-export",
  );
  const definite = globalTokens
    .filter((token) => token.presence === "always")
    .map((token) => token.token);
  const possible = [
    ...globalTokens.filter((token) => token.presence !== "always").map((token) => token.token),
    ...emissionSite.emissionVariants.flatMap((variant) => variant.tokens),
  ].filter((token) => !definite.includes(token));
  const mutuallyExclusiveGroups = collectMutuallyExclusiveGroups(globalTokens);
  const unknownDynamic = emissionSite.unsupported.length > 0;

  return {
    sourceAnchor: normalizeAnchor(emissionSite.sourceLocation),
    value: {
      kind: "class-set",
      definite: uniqueSorted(definite),
      possible: uniqueSorted(possible),
      ...(mutuallyExclusiveGroups.length > 0 ? { mutuallyExclusiveGroups } : {}),
      unknownDynamic,
      ...(unknownDynamic
        ? { reason: "render structure emission site has partial class tokens" }
        : {}),
    },
    classes: {
      definite: uniqueSorted(definite),
      possible: uniqueSorted(possible),
      mutuallyExclusiveGroups,
      unknownDynamic,
      derivedFrom: emissionSite.tokenProvenance.map((provenance) => ({
        ...(provenance.sourceLocation
          ? { sourceAnchor: normalizeAnchor(provenance.sourceLocation) }
          : {}),
        description: `class token "${provenance.token}" emitted by render structure`,
      })),
    },
    classNameSourceAnchors: buildClassNameSourceAnchors(emissionSite),
    sourceText: expression.rawExpressionText,
    traces: [...emissionSite.traces, ...expression.traces],
  };
}

function collectMutuallyExclusiveGroups(tokens: EmissionSite["tokens"]): string[][] {
  const tokensByGroup = new Map<string, string[]>();
  for (const token of tokens) {
    if (!token.exclusiveGroupId) {
      continue;
    }
    const groupTokens = tokensByGroup.get(token.exclusiveGroupId) ?? [];
    groupTokens.push(token.token);
    tokensByGroup.set(token.exclusiveGroupId, groupTokens);
  }

  return [...tokensByGroup.values()]
    .map(uniqueSorted)
    .filter((groupTokens) => groupTokens.length > 1)
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function buildClassNameSourceAnchors(
  emissionSite: EmissionSite,
): Record<string, SourceAnchor> | undefined {
  const anchors: Record<string, SourceAnchor> = {};
  for (const provenance of emissionSite.tokenProvenance) {
    if (provenance.sourceLocation) {
      anchors[provenance.token] = normalizeAnchor(provenance.sourceLocation);
    }
  }

  return Object.keys(anchors).length > 0 ? anchors : undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isExpressionInsideSkippedCondition(
  expression: CanonicalClassExpression,
  skippedConditions: StaticallySkippedPlacementCondition[],
): boolean {
  return skippedConditions.some((condition) =>
    sourceAnchorContains(condition.sourceLocation, expression.location),
  );
}

function isStaticallySkippedCondition(
  condition: PlacementCondition,
): condition is StaticallySkippedPlacementCondition {
  return (
    condition.kind === "statically-skipped-branch" &&
    Boolean(condition.sourceLocation) &&
    Boolean(condition.branch) &&
    (condition.reason === "condition-resolved-true" ||
      condition.reason === "condition-resolved-false" ||
      condition.reason === "expression-resolved-nullish")
  );
}

function buildCanonicalClassReferenceTraces(input: {
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  origin: ClassReferenceAnalysis["origin"];
}): AnalysisTrace[] {
  const traceOrigin = input.origin === "runtime-dom" ? "runtime DOM" : "symbolic render";
  return [
    {
      traceId: `${input.origin}:class-reference:${normalizeProjectPath(input.expression.location.filePath)}:${input.expression.location.startLine}:${input.expression.location.startColumn}`,
      category: "value-evaluation",
      summary: `${traceOrigin} class reference was projected from symbolic evaluation`,
      anchor: normalizeAnchor(input.expression.location),
      children: [...input.classExpression.traces],
      metadata: {
        origin: input.origin,
        expressionId: input.expression.id,
        classExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
        sourceFilePath: normalizeProjectPath(input.expression.filePath),
      },
    },
  ];
}

function buildEmissionSiteClassReferenceTraces(input: {
  emissionSite: EmissionSite;
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
}): AnalysisTrace[] {
  const anchor = normalizeAnchor(
    input.emissionSite.emittedElementLocation ?? input.emissionSite.sourceLocation,
  );

  return [
    {
      traceId: `render-structure:class-reference:${normalizeProjectPath(input.emissionSite.sourceLocation.filePath)}:${input.emissionSite.sourceLocation.startLine}:${input.emissionSite.sourceLocation.startColumn}`,
      category: "render-expansion",
      summary: "class reference was projected from a render structure emission site",
      anchor,
      children: [...input.classExpression.traces],
      metadata: {
        origin: "render-ir",
        expressionId: input.expression.id,
        emissionSiteId: input.emissionSite.id,
        classExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
        renderPathId: input.emissionSite.renderPathId,
        componentId:
          input.emissionSite.suppliedByComponentNodeId ??
          input.emissionSite.emittingComponentNodeId,
        suppliedByComponentNodeId: input.emissionSite.suppliedByComponentNodeId,
        emittedByComponentNodeId: input.emissionSite.emittingComponentNodeId,
        sourceFilePath: normalizeProjectPath(input.expression.filePath),
      },
    },
  ];
}

function buildStaticallySkippedClassReferenceTraces(input: {
  condition: PlacementCondition;
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  componentId?: ProjectAnalysisId;
}): AnalysisTrace[] {
  return [
    {
      traceId: `render-structure:statically-skipped-class-reference:${normalizeProjectPath(input.expression.location.filePath)}:${input.expression.location.startLine}:${input.expression.location.startColumn}`,
      category: "render-expansion",
      summary: "class reference was projected from a render branch that static analysis skipped",
      anchor: normalizeAnchor(input.expression.location),
      children: [...input.classExpression.traces],
      metadata: {
        conditionId: input.condition.id,
        componentId: input.componentId,
        conditionSourceText: input.condition.sourceText,
        skippedBranch: input.condition.branch,
        skippedReason: input.condition.reason,
      },
    },
  ];
}

function sortEmissionSites(emissionSites: EmissionSite[]): EmissionSite[] {
  return [...emissionSites].sort(compareEmissionSites);
}

function compareEmissionSites(left: EmissionSite, right: EmissionSite): number {
  return (
    compareAnchors(left.sourceLocation, right.sourceLocation) ||
    compareOptionalAnchors(left.emittedElementLocation, right.emittedElementLocation) ||
    compareOptionalAnchors(left.placementLocation, right.placementLocation) ||
    (left.suppliedByComponentNodeId ?? "").localeCompare(right.suppliedByComponentNodeId ?? "") ||
    (left.emittingComponentNodeId ?? "").localeCompare(right.emittingComponentNodeId ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function compareCanonicalClassExpressions(
  left: CanonicalClassExpression,
  right: CanonicalClassExpression,
): number {
  return compareAnchors(left.location, right.location) || left.id.localeCompare(right.id);
}

function comparePlacementConditions(left: PlacementCondition, right: PlacementCondition): number {
  return (
    compareOptionalAnchors(left.sourceLocation, right.sourceLocation) ||
    left.id.localeCompare(right.id)
  );
}

function compareOptionalAnchors(
  left: SourceAnchor | undefined,
  right: SourceAnchor | undefined,
): number {
  if (left && right) {
    return compareAnchors(left, right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function sourceAnchorContains(containing: SourceAnchor, contained: SourceAnchor): boolean {
  const containingPath = normalizeProjectPath(containing.filePath);
  const containedPath = normalizeProjectPath(contained.filePath);
  if (containingPath !== containedPath) {
    return false;
  }

  const containingStart = toAnchorPositionValue(containing.startLine, containing.startColumn);
  const containingEnd = toAnchorPositionValue(
    containing.endLine ?? containing.startLine,
    containing.endColumn ?? containing.startColumn,
  );
  const containedStart = toAnchorPositionValue(contained.startLine, contained.startColumn);
  const containedEnd = toAnchorPositionValue(
    contained.endLine ?? contained.startLine,
    contained.endColumn ?? contained.startColumn,
  );

  return containingStart <= containedStart && containingEnd >= containedEnd;
}

function toAnchorPositionValue(line: number, column: number): number {
  return line * 1_000_000 + column;
}
