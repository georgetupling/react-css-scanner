import type { ClassExpressionSummary } from "../../symbolic-evaluation/class-values/types.js";
import { toClassExpressionSummary } from "../../symbolic-evaluation/adapters/classExpressionSummary.js";
import type {
  RenderNode,
  RenderComponentReferenceNode,
  RenderElementNode,
} from "../../render-model/render-ir/types.js";
import type { CanonicalClassExpression } from "../../symbolic-evaluation/types.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import type {
  ClassReferenceAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisId,
  ProjectAnalysisIndexes,
  RenderSubtreeAnalysis,
  StaticallySkippedClassReferenceAnalysis,
  RenderClassExpressionEntry,
  SkippedRenderClassExpressionEntry,
} from "../types.js";
import {
  collectReferenceClassNames,
  collectSkippedReferenceClassNames,
  compareAnchors,
  compareById,
  compareStringRecords,
  createAnchorId,
  createComponentKey,
  createPathId,
  getReferenceConfidence,
  getReferenceExpressionKind,
  normalizeAnchor,
  normalizeOptionalAnchor,
  normalizeProjectPath,
  pushMapValue,
  sortIndexValues,
} from "../internal/shared.js";

export function buildClassReferences(input: {
  renderSubtrees: RenderSubtreeAnalysis[];
  symbolicEvaluation: ProjectAnalysisBuildInput["symbolicEvaluation"];
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): ClassReferenceAnalysis[] {
  const classExpressions = deduplicateRenderClassExpressions(
    input.renderSubtrees.flatMap((renderSubtree) =>
      collectRenderClassExpressions(renderSubtree, input.indexes),
    ),
  );

  const references = input.symbolicEvaluation
    ? buildSymbolicClassReferences({
        classExpressions: input.symbolicEvaluation.evaluatedExpressions.classExpressions,
        renderEntries: classExpressions,
        factGraph: input.factGraph,
        indexes: input.indexes,
        includeTraces: input.includeTraces,
      })
    : classExpressions.map((entry, index) => buildRenderClassReference(input, entry, index));

  sortIndexValues(input.indexes.referencesBySourceFileId);
  sortIndexValues(input.indexes.referencesByClassName);
  return references.sort(compareById);
}

function buildRenderClassReference(
  input: {
    indexes: ProjectAnalysisIndexes;
    includeTraces: boolean;
  },
  entry: RenderClassExpressionEntry,
  index: number,
): ClassReferenceAnalysis {
  const { classExpression, emittedElementLocation, placementLocation, renderSubtreeId } = entry;
  const filePath = normalizeProjectPath(classExpression.sourceAnchor.filePath);
  const sourceFileId =
    input.indexes.sourceFileIdByPath.get(filePath) ?? createPathId("source", filePath);
  const componentId = entry.suppliedByComponentId ?? entry.emittedByComponentId;
  const id = createAnchorId("class-reference", classExpression.sourceAnchor, index);
  const reference: ClassReferenceAnalysis = {
    id,
    sourceFileId,
    componentId,
    suppliedByComponentId: entry.suppliedByComponentId,
    emittedByComponentId: entry.emittedByComponentId,
    classNameComponentIds: entry.classNameComponentIds,
    renderSubtreeId,
    location: normalizeAnchor(classExpression.sourceAnchor),
    emittedElementLocation,
    placementLocation,
    origin: "render-ir",
    expressionKind: getReferenceExpressionKind(classExpression),
    rawExpressionText: classExpression.sourceText,
    definiteClassNames: [...classExpression.classes.definite],
    possibleClassNames: [...classExpression.classes.possible],
    unknownDynamic: classExpression.classes.unknownDynamic,
    confidence: getReferenceConfidence(classExpression),
    traces: input.includeTraces ? buildClassReferenceTraces(entry) : [],
    sourceSummary: classExpression,
  };

  pushMapValue(input.indexes.referencesBySourceFileId, sourceFileId, id);
  for (const className of collectReferenceClassNames(reference)) {
    pushMapValue(input.indexes.referencesByClassName, className, id);
  }

  return reference;
}

function buildSymbolicClassReferences(input: {
  classExpressions: CanonicalClassExpression[];
  renderEntries: RenderClassExpressionEntry[];
  factGraph: ProjectAnalysisBuildInput["factGraph"];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): ClassReferenceAnalysis[] {
  const symbolicExpressionByAnchor = new Map(
    input.classExpressions
      .filter(
        (expression) =>
          expression.classExpressionSiteKind !== "runtime-dom-class" &&
          shouldProjectCanonicalClassExpression(expression),
      )
      .map((expression) => [createAnchorKey(expression.location), expression]),
  );
  const references: ClassReferenceAnalysis[] = [];

  for (const renderEntry of input.renderEntries) {
    const symbolicExpression = symbolicExpressionByAnchor.get(
      createClassExpressionAnchorKey(renderEntry.classExpression),
    );
    if (symbolicExpression) {
      const symbolicClassExpression = toClassExpressionSummary(symbolicExpression);
      if (!shouldUseSymbolicClassExpressionForRenderEntry(symbolicClassExpression, renderEntry)) {
        references.push(buildRenderClassReference(input, renderEntry, references.length));
        continue;
      }

      references.push(
        buildSymbolicClassReference({
          expression: symbolicExpression,
          classExpression: symbolicClassExpression,
          renderEntry,
          factGraph: input.factGraph,
          indexes: input.indexes,
          includeTraces: input.includeTraces,
          index: references.length,
        }),
      );
      continue;
    }

    references.push(buildRenderClassReference(input, renderEntry, references.length));
  }

  for (const expression of input.classExpressions) {
    if (
      expression.classExpressionSiteKind !== "runtime-dom-class" ||
      !shouldProjectCanonicalClassExpression(expression)
    ) {
      continue;
    }

    references.push(
      buildSymbolicClassReference({
        expression,
        classExpression: toClassExpressionSummary(expression),
        factGraph: input.factGraph,
        indexes: input.indexes,
        includeTraces: input.includeTraces,
        index: references.length,
      }),
    );
  }

  return references;
}

function buildSymbolicClassReference(input: {
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  renderEntry?: RenderClassExpressionEntry;
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
  const id = createAnchorId(
    input.expression.classExpressionSiteKind === "runtime-dom-class"
      ? "runtime-dom-class-reference"
      : "class-reference",
    input.expression.location,
    input.index,
  );
  const reference: ClassReferenceAnalysis = {
    id,
    sourceFileId,
    componentId:
      input.renderEntry?.suppliedByComponentId ?? input.renderEntry?.emittedByComponentId,
    suppliedByComponentId: input.renderEntry?.suppliedByComponentId,
    emittedByComponentId: input.renderEntry?.emittedByComponentId,
    classNameComponentIds: input.renderEntry?.classNameComponentIds,
    renderSubtreeId: input.renderEntry?.renderSubtreeId,
    location: normalizeAnchor(input.expression.location),
    ...(input.renderEntry?.emittedElementLocation
      ? { emittedElementLocation: input.renderEntry.emittedElementLocation }
      : {}),
    ...(input.renderEntry?.placementLocation
      ? { placementLocation: input.renderEntry.placementLocation }
      : {}),
    origin:
      input.expression.classExpressionSiteKind === "runtime-dom-class"
        ? "runtime-dom"
        : "render-ir",
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
          renderEntry: input.renderEntry,
        })
      : [],
    sourceSummary: input.classExpression,
  };

  pushMapValue(input.indexes.referencesBySourceFileId, sourceFileId, id);
  for (const className of collectReferenceClassNames(reference)) {
    pushMapValue(input.indexes.referencesByClassName, className, id);
  }

  return reference;
}

export function buildStaticallySkippedClassReferences(input: {
  renderSubtrees: RenderSubtreeAnalysis[];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): StaticallySkippedClassReferenceAnalysis[] {
  const entries = deduplicateSkippedRenderClassExpressions(
    input.renderSubtrees.flatMap((renderSubtree) =>
      collectStaticallySkippedRenderClassExpressions(renderSubtree, input.indexes),
    ),
  );

  const references = entries.map((entry, index) => {
    const { classExpression, skippedBranch, renderSubtreeId } = entry;
    const filePath = normalizeProjectPath(classExpression.sourceAnchor.filePath);
    const sourceFileId =
      input.indexes.sourceFileIdByPath.get(filePath) ?? createPathId("source", filePath);
    const id = createAnchorId(
      "statically-skipped-class-reference",
      classExpression.sourceAnchor,
      index,
    );
    const reference: StaticallySkippedClassReferenceAnalysis = {
      id,
      sourceFileId,
      componentId: entry.emittedByComponentId,
      renderSubtreeId,
      location: normalizeAnchor(classExpression.sourceAnchor),
      branchLocation: normalizeAnchor(skippedBranch.sourceAnchor),
      conditionSourceText: skippedBranch.conditionSourceText,
      skippedBranch: skippedBranch.skippedBranch,
      reason: skippedBranch.reason,
      rawExpressionText: classExpression.sourceText,
      definiteClassNames: [...classExpression.classes.definite],
      possibleClassNames: [...classExpression.classes.possible],
      unknownDynamic: classExpression.classes.unknownDynamic,
      confidence: getReferenceConfidence(classExpression),
      traces: input.includeTraces ? buildStaticallySkippedClassReferenceTraces(entry) : [],
      sourceSummary: classExpression,
    };

    for (const className of collectSkippedReferenceClassNames(reference)) {
      pushMapValue(input.indexes.staticallySkippedReferencesByClassName, className, id);
    }

    return reference;
  });

  sortIndexValues(input.indexes.staticallySkippedReferencesByClassName);
  return references.sort(compareById);
}

export function collectRenderClassExpressions(
  input: RenderSubtreeAnalysis,
  indexes: ProjectAnalysisIndexes,
): RenderClassExpressionEntry[] {
  const entries: RenderClassExpressionEntry[] = [];

  visitRenderNode(
    input.sourceSubtree.root,
    undefined,
    undefined,
    (node, inheritedPlacementLocation, inheritedExpansion) => {
      if (!node.className) {
        return;
      }

      const emittedByComponentId = resolveEffectiveComponentId({
        renderSubtree: input,
        inheritedExpansion,
        indexes,
      });

      entries.push({
        classExpression: node.className,
        suppliedByComponentId: resolveSupplierComponentId({
          renderSubtree: input,
          inheritedExpansion,
          classExpression: node.className,
          emittedByComponentId,
          indexes,
        }),
        emittedByComponentId,
        classNameComponentIds: buildClassNameComponentIds({
          renderSubtree: input,
          inheritedExpansion,
          classExpression: node.className,
          emittedByComponentId,
          indexes,
        }),
        renderSubtreeId: input.id,
        emittedElementLocation: normalizeAnchor(node.sourceAnchor),
        placementLocation: normalizeOptionalAnchor(
          node.placementAnchor ?? inheritedPlacementLocation,
        ),
      });
    },
  );

  return entries.sort((left, right) =>
    `${left.classExpression.sourceAnchor.filePath}:${left.classExpression.sourceAnchor.startLine}:${left.classExpression.sourceAnchor.startColumn}`.localeCompare(
      `${right.classExpression.sourceAnchor.filePath}:${right.classExpression.sourceAnchor.startLine}:${right.classExpression.sourceAnchor.startColumn}`,
    ),
  );
}

export function collectStaticallySkippedRenderClassExpressions(
  input: RenderSubtreeAnalysis,
  indexes: ProjectAnalysisIndexes,
): SkippedRenderClassExpressionEntry[] {
  const entries: SkippedRenderClassExpressionEntry[] = [];

  visitStaticallySkippedBranches(
    input.sourceSubtree.root,
    undefined,
    undefined,
    (skippedBranch, inheritedPlacementLocation, inheritedExpansion) => {
      for (const entry of collectRenderClassExpressionsFromNode({
        node: skippedBranch.node,
        renderSubtree: input,
        indexes,
        inheritedPlacementLocation,
        inheritedExpansion,
      })) {
        entries.push({
          ...entry,
          skippedBranch,
        });
      }
    },
  );

  return entries.sort(compareSkippedRenderClassExpressionEntries);
}

export function collectRenderClassExpressionsFromNode(input: {
  node: RenderNode;
  renderSubtree: RenderSubtreeAnalysis;
  indexes: ProjectAnalysisIndexes;
  inheritedPlacementLocation: SourceAnchor | undefined;
  inheritedExpansion: NonNullable<RenderNode["expandedFromComponentReference"]> | undefined;
}): RenderClassExpressionEntry[] {
  const entries: RenderClassExpressionEntry[] = [];

  visitRenderNode(
    input.node,
    input.inheritedPlacementLocation,
    input.inheritedExpansion,
    (node, inheritedPlacementLocation, inheritedExpansion) => {
      if (!node.className) {
        return;
      }

      const emittedByComponentId = resolveEffectiveComponentId({
        renderSubtree: input.renderSubtree,
        inheritedExpansion,
        indexes: input.indexes,
      });

      entries.push({
        classExpression: node.className,
        suppliedByComponentId: resolveSupplierComponentId({
          renderSubtree: input.renderSubtree,
          inheritedExpansion,
          classExpression: node.className,
          emittedByComponentId,
          indexes: input.indexes,
        }),
        emittedByComponentId,
        classNameComponentIds: buildClassNameComponentIds({
          renderSubtree: input.renderSubtree,
          inheritedExpansion,
          classExpression: node.className,
          emittedByComponentId,
          indexes: input.indexes,
        }),
        renderSubtreeId: input.renderSubtree.id,
        emittedElementLocation: normalizeAnchor(node.sourceAnchor),
        placementLocation: normalizeOptionalAnchor(
          node.placementAnchor ?? inheritedPlacementLocation,
        ),
      });
    },
  );

  return entries.sort(compareRenderClassExpressionEntries);
}

export function deduplicateRenderClassExpressions(
  entries: RenderClassExpressionEntry[],
): RenderClassExpressionEntry[] {
  const entriesByKey = new Map<string, RenderClassExpressionEntry>();

  for (const entry of entries) {
    const key = createRenderClassExpressionDedupeKey(entry);
    const existing = entriesByKey.get(key);
    if (!existing || compareRenderClassExpressionEntries(entry, existing) < 0) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()].sort(compareRenderClassExpressionEntries);
}

export function deduplicateSkippedRenderClassExpressions(
  entries: SkippedRenderClassExpressionEntry[],
): SkippedRenderClassExpressionEntry[] {
  const entriesByKey = new Map<string, SkippedRenderClassExpressionEntry>();

  for (const entry of entries) {
    const key = [
      createRenderClassExpressionDedupeKey(entry),
      entry.skippedBranch.sourceAnchor.filePath,
      entry.skippedBranch.sourceAnchor.startLine,
      entry.skippedBranch.sourceAnchor.startColumn,
      entry.skippedBranch.skippedBranch,
      entry.skippedBranch.reason,
    ].join(":");
    const existing = entriesByKey.get(key);
    if (!existing || compareSkippedRenderClassExpressionEntries(entry, existing) < 0) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()].sort(compareSkippedRenderClassExpressionEntries);
}

export function createRenderClassExpressionDedupeKey(entry: RenderClassExpressionEntry): string {
  const classExpression = entry.classExpression;
  return [
    normalizeProjectPath(classExpression.sourceAnchor.filePath),
    classExpression.sourceAnchor.startLine,
    classExpression.sourceAnchor.startColumn,
    classExpression.sourceAnchor.endLine ?? "",
    classExpression.sourceAnchor.endColumn ?? "",
    classExpression.classes.definite.join(" "),
    classExpression.classes.possible.join(" "),
    classExpression.classes.unknownDynamic ? "dynamic" : "static",
    entry.suppliedByComponentId ?? "",
    entry.emittedByComponentId ?? "",
    Object.entries(entry.classNameComponentIds ?? {})
      .map(([className, componentId]) => `${className}=${componentId}`)
      .join(","),
  ].join(":");
}

export function compareRenderClassExpressionEntries(
  left: RenderClassExpressionEntry,
  right: RenderClassExpressionEntry,
): number {
  return (
    compareAnchors(left.classExpression.sourceAnchor, right.classExpression.sourceAnchor) ||
    compareAnchors(left.emittedElementLocation, right.emittedElementLocation) ||
    (left.placementLocation && right.placementLocation
      ? compareAnchors(left.placementLocation, right.placementLocation)
      : left.placementLocation
        ? -1
        : right.placementLocation
          ? 1
          : 0) ||
    (left.suppliedByComponentId ?? "").localeCompare(right.suppliedByComponentId ?? "") ||
    (left.emittedByComponentId ?? "").localeCompare(right.emittedByComponentId ?? "") ||
    compareStringRecords(left.classNameComponentIds, right.classNameComponentIds) ||
    left.renderSubtreeId.localeCompare(right.renderSubtreeId)
  );
}

export function compareSkippedRenderClassExpressionEntries(
  left: SkippedRenderClassExpressionEntry,
  right: SkippedRenderClassExpressionEntry,
): number {
  return (
    compareRenderClassExpressionEntries(left, right) ||
    compareAnchors(left.skippedBranch.sourceAnchor, right.skippedBranch.sourceAnchor) ||
    left.skippedBranch.skippedBranch.localeCompare(right.skippedBranch.skippedBranch) ||
    left.skippedBranch.reason.localeCompare(right.skippedBranch.reason)
  );
}

export function resolveEffectiveComponentId(input: {
  renderSubtree: RenderSubtreeAnalysis;
  inheritedExpansion?: NonNullable<RenderNode["expandedFromComponentReference"]>;
  indexes: ProjectAnalysisIndexes;
}): ProjectAnalysisId | undefined {
  if (!input.inheritedExpansion) {
    return input.renderSubtree.componentId;
  }

  return (
    (input.inheritedExpansion.componentKey
      ? input.indexes.componentIdByComponentKey.get(input.inheritedExpansion.componentKey)
      : input.indexes.componentIdByFilePathAndName.get(
          createComponentKey(
            normalizeProjectPath(input.inheritedExpansion.filePath),
            input.inheritedExpansion.componentName,
          ),
        )) ?? input.renderSubtree.componentId
  );
}

export function resolveSupplierComponentId(input: {
  renderSubtree: RenderSubtreeAnalysis;
  inheritedExpansion?: NonNullable<RenderNode["expandedFromComponentReference"]>;
  classExpression: ClassExpressionSummary;
  emittedByComponentId?: ProjectAnalysisId;
  indexes: ProjectAnalysisIndexes;
}): ProjectAnalysisId | undefined {
  const sourceFilePath = normalizeProjectPath(input.classExpression.sourceAnchor.filePath);
  if (sourceFilePath === input.renderSubtree.filePath) {
    return input.renderSubtree.componentId;
  }

  if (
    input.inheritedExpansion &&
    sourceFilePath === normalizeProjectPath(input.inheritedExpansion.filePath)
  ) {
    return input.emittedByComponentId;
  }

  const componentIdsForSource = [...input.indexes.componentIdByFilePathAndName.entries()]
    .filter(([key]) => key.startsWith(`${sourceFilePath}::`))
    .map(([, componentId]) => componentId);

  if (componentIdsForSource.length === 1) {
    return componentIdsForSource[0];
  }

  return input.emittedByComponentId;
}

export function buildClassNameComponentIds(input: {
  renderSubtree: RenderSubtreeAnalysis;
  inheritedExpansion?: NonNullable<RenderNode["expandedFromComponentReference"]>;
  classExpression: ClassExpressionSummary;
  emittedByComponentId?: ProjectAnalysisId;
  indexes: ProjectAnalysisIndexes;
}): Record<string, ProjectAnalysisId> | undefined {
  if (!input.classExpression.classNameSourceAnchors) {
    return undefined;
  }

  const componentIdsByClassName: Record<string, ProjectAnalysisId> = {};
  for (const [className, sourceAnchor] of Object.entries(
    input.classExpression.classNameSourceAnchors,
  )) {
    const componentId = resolveSupplierComponentIdForSourceAnchor({
      renderSubtree: input.renderSubtree,
      inheritedExpansion: input.inheritedExpansion,
      sourceAnchor,
      emittedByComponentId: input.emittedByComponentId,
      indexes: input.indexes,
    });
    if (componentId) {
      componentIdsByClassName[className] = componentId;
    }
  }

  return Object.keys(componentIdsByClassName).length > 0 ? componentIdsByClassName : undefined;
}

export function resolveSupplierComponentIdForSourceAnchor(input: {
  renderSubtree: RenderSubtreeAnalysis;
  inheritedExpansion?: NonNullable<RenderNode["expandedFromComponentReference"]>;
  sourceAnchor: SourceAnchor;
  emittedByComponentId?: ProjectAnalysisId;
  indexes: ProjectAnalysisIndexes;
}): ProjectAnalysisId | undefined {
  const sourceFilePath = normalizeProjectPath(input.sourceAnchor.filePath);
  if (sourceFilePath === input.renderSubtree.filePath) {
    return input.renderSubtree.componentId;
  }

  if (
    input.inheritedExpansion &&
    sourceFilePath === normalizeProjectPath(input.inheritedExpansion.filePath)
  ) {
    return input.emittedByComponentId;
  }

  const componentIdsForSource = [...input.indexes.componentIdByFilePathAndName.entries()]
    .filter(([key]) => key.startsWith(`${sourceFilePath}::`))
    .map(([, componentId]) => componentId);

  if (componentIdsForSource.length === 1) {
    return componentIdsForSource[0];
  }

  return input.emittedByComponentId;
}

export function buildClassReferenceTraces(entry: RenderClassExpressionEntry): AnalysisTrace[] {
  return [
    {
      traceId: `render-expansion:class-reference:${normalizeProjectPath(entry.classExpression.sourceAnchor.filePath)}:${entry.classExpression.sourceAnchor.startLine}:${entry.classExpression.sourceAnchor.startColumn}`,
      category: "render-expansion",
      summary: "class reference was collected from the render IR",
      anchor: normalizeAnchor(entry.emittedElementLocation),
      children: [...entry.classExpression.traces],
      metadata: {
        renderSubtreeId: entry.renderSubtreeId,
        componentId: entry.suppliedByComponentId ?? entry.emittedByComponentId,
        suppliedByComponentId: entry.suppliedByComponentId,
        emittedByComponentId: entry.emittedByComponentId,
        classNameComponentIds: entry.classNameComponentIds,
        sourceFilePath: normalizeProjectPath(entry.classExpression.sourceAnchor.filePath),
        emittedElementFilePath: normalizeProjectPath(entry.emittedElementLocation.filePath),
        placementFilePath: entry.placementLocation
          ? normalizeProjectPath(entry.placementLocation.filePath)
          : undefined,
      },
    },
  ];
}

export function buildStaticallySkippedClassReferenceTraces(
  entry: SkippedRenderClassExpressionEntry,
): AnalysisTrace[] {
  return [
    {
      traceId: `render-expansion:statically-skipped-class-reference:${normalizeProjectPath(entry.classExpression.sourceAnchor.filePath)}:${entry.classExpression.sourceAnchor.startLine}:${entry.classExpression.sourceAnchor.startColumn}`,
      category: "render-expansion",
      summary: "class reference was collected from a render branch that static analysis skipped",
      anchor: normalizeAnchor(entry.emittedElementLocation),
      children: [...entry.classExpression.traces],
      metadata: {
        renderSubtreeId: entry.renderSubtreeId,
        componentId: entry.suppliedByComponentId ?? entry.emittedByComponentId,
        suppliedByComponentId: entry.suppliedByComponentId,
        emittedByComponentId: entry.emittedByComponentId,
        classNameComponentIds: entry.classNameComponentIds,
        conditionSourceText: entry.skippedBranch.conditionSourceText,
        skippedBranch: entry.skippedBranch.skippedBranch,
        skippedReason: entry.skippedBranch.reason,
      },
    },
  ];
}

export function buildCanonicalClassReferenceTraces(input: {
  expression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  renderEntry?: RenderClassExpressionEntry;
}): AnalysisTrace[] {
  const isRuntimeDom = input.expression.classExpressionSiteKind === "runtime-dom-class";
  const anchor = normalizeAnchor(
    input.renderEntry?.emittedElementLocation ?? input.expression.location,
  );

  return [
    {
      traceId: `${isRuntimeDom ? "runtime-dom" : "symbolic-evaluation"}:class-reference:${normalizeProjectPath(input.expression.location.filePath)}:${input.expression.location.startLine}:${input.expression.location.startColumn}`,
      category: isRuntimeDom ? "value-evaluation" : "render-expansion",
      summary: isRuntimeDom
        ? "runtime DOM class reference was projected from symbolic evaluation"
        : "class reference was projected from symbolic evaluation",
      anchor,
      children: [...input.classExpression.traces],
      metadata: {
        origin: isRuntimeDom ? "runtime-dom" : "render-ir",
        expressionId: input.expression.id,
        classExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
        renderSubtreeId: input.renderEntry?.renderSubtreeId,
        componentId:
          input.renderEntry?.suppliedByComponentId ?? input.renderEntry?.emittedByComponentId,
        sourceFilePath: normalizeProjectPath(input.expression.filePath),
      },
    },
  ];
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

function shouldUseSymbolicClassExpressionForRenderEntry(
  symbolicClassExpression: ClassExpressionSummary,
  renderEntry: RenderClassExpressionEntry,
): boolean {
  const symbolicClassNames = new Set([
    ...symbolicClassExpression.classes.definite,
    ...symbolicClassExpression.classes.possible,
  ]);
  const renderClassNames = [
    ...renderEntry.classExpression.classes.definite,
    ...renderEntry.classExpression.classes.possible,
  ];

  return renderClassNames.every((className) => symbolicClassNames.has(className));
}

function createClassExpressionAnchorKey(classExpression: ClassExpressionSummary): string {
  return createAnchorKey(classExpression.sourceAnchor);
}

function createAnchorKey(sourceAnchor: SourceAnchor): string {
  const anchor = normalizeAnchor(sourceAnchor);
  return [
    anchor.filePath,
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}

export function visitRenderNode(
  node: RenderNode,
  inheritedPlacementLocation: SourceAnchor | undefined,
  inheritedExpansion: NonNullable<RenderNode["expandedFromComponentReference"]> | undefined,
  visitElement: (
    node: RenderElementNode | RenderComponentReferenceNode,
    inheritedPlacementLocation: SourceAnchor | undefined,
    inheritedExpansion: NonNullable<RenderNode["expandedFromComponentReference"]> | undefined,
  ) => void,
): void {
  const placementLocation = node.placementAnchor ?? inheritedPlacementLocation;
  const expansion = node.expandedFromComponentReference ?? inheritedExpansion;

  if (node.kind === "element") {
    visitElement(node, inheritedPlacementLocation, expansion);
    for (const child of node.children) {
      visitRenderNode(child, placementLocation, expansion, visitElement);
    }
    return;
  }

  if (node.kind === "component-reference") {
    visitElement(node, inheritedPlacementLocation, expansion);
    return;
  }

  if (node.kind === "fragment") {
    for (const child of node.children) {
      visitRenderNode(child, placementLocation, expansion, visitElement);
    }
    return;
  }

  if (node.kind === "conditional") {
    visitRenderNode(node.whenTrue, placementLocation, expansion, visitElement);
    visitRenderNode(node.whenFalse, placementLocation, expansion, visitElement);
    return;
  }

  if (node.kind === "repeated-region") {
    visitRenderNode(node.template, placementLocation, expansion, visitElement);
  }
}

export function visitStaticallySkippedBranches(
  node: RenderNode,
  inheritedPlacementLocation: SourceAnchor | undefined,
  inheritedExpansion: NonNullable<RenderNode["expandedFromComponentReference"]> | undefined,
  visitSkippedBranch: (
    skippedBranch: NonNullable<RenderNode["staticallySkippedBranches"]>[number],
    inheritedPlacementLocation: SourceAnchor | undefined,
    inheritedExpansion: NonNullable<RenderNode["expandedFromComponentReference"]> | undefined,
  ) => void,
): void {
  const placementLocation = node.placementAnchor ?? inheritedPlacementLocation;
  const expansion = node.expandedFromComponentReference ?? inheritedExpansion;

  for (const skippedBranch of node.staticallySkippedBranches ?? []) {
    visitSkippedBranch(skippedBranch, placementLocation, expansion);
    visitStaticallySkippedBranches(
      skippedBranch.node,
      placementLocation,
      expansion,
      visitSkippedBranch,
    );
  }

  if (node.kind === "element") {
    for (const child of node.children) {
      visitStaticallySkippedBranches(child, placementLocation, expansion, visitSkippedBranch);
    }
    return;
  }

  if (node.kind === "fragment") {
    for (const child of node.children) {
      visitStaticallySkippedBranches(child, placementLocation, expansion, visitSkippedBranch);
    }
    return;
  }

  if (node.kind === "conditional") {
    visitStaticallySkippedBranches(node.whenTrue, placementLocation, expansion, visitSkippedBranch);
    visitStaticallySkippedBranches(
      node.whenFalse,
      placementLocation,
      expansion,
      visitSkippedBranch,
    );
    return;
  }

  if (node.kind === "repeated-region") {
    visitStaticallySkippedBranches(node.template, placementLocation, expansion, visitSkippedBranch);
  }
}
