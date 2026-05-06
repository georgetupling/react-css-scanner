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
  ProjectEvidenceBuildInput,
  ProjectEvidenceId,
  ProjectEvidenceBuilderIndexes,
  StaticallySkippedClassReferenceAnalysis,
} from "../analysisTypes.js";
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

type ClassReferencesProfiler = {
  enabled: boolean;
  totals: Map<string, number>;
  counts: Map<string, number>;
  time<T>(label: string, run: () => T): T;
  logSummary(): void;
};

type ClassExpressionSiteLookupResult = {
  rawExpressionText: string;
  emittingComponentNodeId?: string;
};

type ClassExpressionSiteLookupEntry = {
  location: SourceAnchor;
  span: number;
  rawExpressionText: string;
  emittingComponentNodeId?: string;
};

type ComponentLookupEntry = {
  location: SourceAnchor;
  span: number;
  componentKey: string;
};

type ClassReferencesLookupContext = {
  classExpressionSitesByFilePath: Map<string, ClassExpressionSiteLookupEntry[]>;
  componentsByFilePath: Map<string, ComponentLookupEntry[]>;
  classExpressionSiteLookupCache: Map<string, ClassExpressionSiteLookupResult | null>;
  componentAtLocationCache: Map<string, ProjectEvidenceId | null>;
};

export function buildClassReferences(input: {
  renderModel: RenderModel;
  symbolicEvaluation: ProjectEvidenceBuildInput["symbolicEvaluation"];
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
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
  symbolicEvaluation: NonNullable<ProjectEvidenceBuildInput["symbolicEvaluation"]>;
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): ClassReferenceAnalysis[] {
  const profiler = createClassReferencesProfiler(
    process.env.SCAN_REACT_CSS_PROFILE_PROJECT_EVIDENCE === "1",
  );
  const lookupContext = createClassReferencesLookupContext(input.factGraph);
  const expressionsById = new Map(
    input.symbolicEvaluation.evaluatedExpressions.classExpressions.map((expression) => [
      expression.id,
      expression,
    ]),
  );
  const skippedConditions = input.renderModel.placementConditions
    .filter(isStaticallySkippedCondition)
    .sort(comparePlacementConditions);
  const references: ClassReferenceAnalysis[] = [];
  const emittedReferenceKeys = new Set<string>();
  const consumedComponentPropExpressionIds = collectConsumedComponentPropExpressionIds(
    input.renderModel.emissionSites,
  );
  const unconsumedComponentPropExpressionIds = collectDiagnosticExpressionIds(
    input.renderModel,
    "unconsumed-component-class-prop",
  );

  for (const emissionSite of profiler.time("classReferences.sortEmissionSites", () =>
    sortEmissionSites(input.renderModel.emissionSites),
  )) {
    const expression = expressionsById.get(emissionSite.classExpressionId);
    if (!expression) {
      continue;
    }
    if (isExpressionInsideSkippedCondition(expression, skippedConditions)) {
      continue;
    }
    if (
      shouldSkipConsumedComponentPropFallback({
        emissionSite,
        expression,
        consumedComponentPropExpressionIds,
      })
    ) {
      continue;
    }
    const dedupeKey = profiler.time("classReferences.createEmissionReferenceDedupeKey", () =>
      createEmissionReferenceDedupeKey({
        emissionSite,
        expression,
        factGraph: input.factGraph,
        indexes: input.indexes,
        lookupContext,
        profiler,
      }),
    );
    if (emittedReferenceKeys.has(dedupeKey)) {
      continue;
    }
    emittedReferenceKeys.add(dedupeKey);

    references.push(
      profiler.time("classReferences.buildClassReferenceFromEmissionSite", () =>
        buildClassReferenceFromEmissionSite({
          emissionSite,
          expression,
          factGraph: input.factGraph,
          indexes: input.indexes,
          includeTraces: input.includeTraces,
          index: references.length,
          lookupContext,
          profiler,
        }),
      ),
    );
  }

  const emittedExpressionIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionId),
  );
  const emittedSiteNodeIds = new Set(
    input.renderModel.emissionSites.map((emissionSite) => emissionSite.classExpressionSiteNodeId),
  );
  for (const expression of input.symbolicEvaluation.evaluatedExpressions.classExpressions) {
    if (
      emittedExpressionIds.has(expression.id) ||
      emittedSiteNodeIds.has(expression.classExpressionSiteNodeId) ||
      (expression.classExpressionSiteKind === "component-prop-class" &&
        (shouldSkipConsumedComponentPropSymbolicFallback(
          expression,
          consumedComponentPropExpressionIds,
        ) ||
          unconsumedComponentPropExpressionIds.has(expression.id))) ||
      isExpressionInsideSkippedCondition(expression, skippedConditions) ||
      !shouldProjectSymbolicClassReference(expression)
    ) {
      continue;
    }

    if (
      expression.classExpressionSiteKind !== "runtime-dom-class" &&
      expression.classExpressionSiteKind !== "jsx-class" &&
      expression.classExpressionSiteKind !== "component-prop-class"
    ) {
      continue;
    }

    references.push(
      profiler.time("classReferences.buildSymbolicClassReference", () =>
        buildSymbolicClassReference({
          expression,
          classExpression: toClassExpressionSummary(expression),
          origin:
            expression.classExpressionSiteKind === "runtime-dom-class"
              ? "runtime-dom"
              : "render-ir",
          factGraph: input.factGraph,
          indexes: input.indexes,
          includeTraces: input.includeTraces,
          index: references.length,
          lookupContext,
          profiler,
        }),
      ),
    );
  }

  profiler.logSummary();
  return references.sort(compareById);
}

function collectDiagnosticExpressionIds(
  renderModel: RenderModel,
  code: RenderModel["diagnostics"][number]["code"],
): Set<string> {
  return new Set(
    renderModel.diagnostics
      .filter((diagnostic) => diagnostic.code === code)
      .map((diagnostic) => diagnostic.evaluatedExpressionId)
      .filter((expressionId): expressionId is string => Boolean(expressionId)),
  );
}

function collectConsumedComponentPropExpressionIds(emissionSites: EmissionSite[]): Set<string> {
  const consumed = new Set<string>();
  for (const emissionSite of emissionSites) {
    if (emissionSite.emissionKind !== "merged-element-class") {
      continue;
    }
    for (const sourceExpressionId of emissionSite.sourceExpressionIds) {
      if (sourceExpressionId !== emissionSite.classExpressionId) {
        consumed.add(sourceExpressionId);
      }
    }
  }
  return consumed;
}

function shouldSkipConsumedComponentPropFallback(input: {
  emissionSite: EmissionSite;
  expression: CanonicalClassExpression;
  consumedComponentPropExpressionIds: ReadonlySet<string>;
}): boolean {
  return (
    input.emissionSite.emissionKind === "rendered-element-class" &&
    input.expression.classExpressionSiteKind === "component-prop-class" &&
    input.consumedComponentPropExpressionIds.has(input.expression.id)
  );
}

function shouldSkipConsumedComponentPropSymbolicFallback(
  expression: CanonicalClassExpression,
  consumedComponentPropExpressionIds: ReadonlySet<string>,
): boolean {
  if (!consumedComponentPropExpressionIds.has(expression.id)) {
    return false;
  }

  return !isConcreteComponentPropSupply(expression);
}

function isConcreteComponentPropSupply(expression: CanonicalClassExpression): boolean {
  return (
    expression.externalContributions.length === 0 &&
    expression.unsupported.length === 0 &&
    expression.tokens.some((token) => token.tokenKind !== "css-module-export")
  );
}

function buildClassReferenceFromEmissionSite(input: {
  emissionSite: EmissionSite;
  expression: CanonicalClassExpression;
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
  index: number;
  lookupContext: ClassReferencesLookupContext;
  profiler: ClassReferencesProfiler;
}): ClassReferenceAnalysis {
  const site = input.factGraph?.graph.indexes.nodesById.get(
    input.expression.classExpressionSiteNodeId,
  );
  const classExpression = input.profiler.time(
    "classReferences.withInferredTemplateCandidates",
    () =>
      withInferredTemplateCandidates(
        toEmissionSiteClassExpressionSummary(input.emissionSite, input.expression),
        input.expression.rawExpressionText,
        [...input.indexes.definitionsByClassName.keys()],
        shouldInferTemplateCandidatesForSite(site),
      ),
  );
  const sourceLocation = resolveReferenceSourceLocation(classExpression, input.emissionSite);
  const sourceSite = findClassExpressionSiteAtLocation(
    sourceLocation,
    input.lookupContext,
    input.profiler,
  );
  const sourceFileId =
    input.indexes.sourceFileIdByPath.get(sourceLocation.filePath) ??
    createPathId("source", sourceLocation.filePath);
  const emittedByComponentId = projectComponentNodeId(
    input.emissionSite.emittingComponentNodeId,
    input,
  );
  const sourceComponentId =
    projectComponentNodeId(sourceSite?.emittingComponentNodeId, input) ??
    projectComponentAtLocation(sourceLocation, input, input.lookupContext, input.profiler);
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
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
  index: number;
  lookupContext: ClassReferencesLookupContext;
  profiler: ClassReferencesProfiler;
}): ClassReferenceAnalysis {
  const site = input.factGraph?.graph.indexes.nodesById.get(
    input.expression.classExpressionSiteNodeId,
  );
  const classExpression = input.profiler.time(
    "classReferences.withInferredTemplateCandidates",
    () =>
      withInferredTemplateCandidates(
        input.classExpression,
        input.expression.rawExpressionText,
        [...input.indexes.definitionsByClassName.keys()],
        shouldInferTemplateCandidatesForSite(site),
      ),
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
    expressionKind: getReferenceExpressionKind(classExpression),
    rawExpressionText: input.expression.rawExpressionText,
    definiteClassNames: [...classExpression.classes.definite],
    possibleClassNames: [...classExpression.classes.possible],
    unknownDynamic: classExpression.classes.unknownDynamic,
    confidence: getReferenceConfidence(classExpression),
    traces: input.includeTraces
      ? buildCanonicalClassReferenceTraces({
          expression: input.expression,
          classExpression,
          origin: input.origin,
        })
      : [],
    sourceSummary: classExpression,
  };

  pushClassReferenceIndexes(input.indexes, reference);
  return reference;
}

function withInferredTemplateCandidates(
  classExpression: ClassExpressionSummary,
  rawExpressionText: string,
  knownClassNames: string[],
  allowInference: boolean,
): ClassExpressionSummary {
  if (
    !allowInference ||
    !classExpression.classes.unknownDynamic ||
    classExpression.classes.possible.length > 0 ||
    knownClassNames.length === 0
  ) {
    return classExpression;
  }

  const inferred = inferTemplatePatternClassNames(rawExpressionText, knownClassNames);
  if (inferred.length === 0) {
    return classExpression;
  }

  return {
    ...classExpression,
    classes: {
      ...classExpression.classes,
      possible: inferred,
    },
  };
}

function shouldInferTemplateCandidatesForSite(site: unknown): boolean {
  if (!site || typeof site !== "object" || !("classExpressionSiteKey" in site)) {
    return true;
  }
  const classExpressionSiteKey = site.classExpressionSiteKey;
  return typeof classExpressionSiteKey !== "string"
    ? true
    : !classExpressionSiteKey.includes("clone-element-class");
}

function inferTemplatePatternClassNames(
  rawExpressionText: string,
  knownClassNames: string[],
): string[] {
  const templateMatch = rawExpressionText.match(/`([^`]*)`/);
  if (!templateMatch) {
    return [];
  }

  const templateText = templateMatch[1];
  if (!templateText.includes("${")) {
    return [];
  }

  const tokens = templateText.split(/\s+/).filter(Boolean);
  const staticAnchors = tokens.filter((token) => !token.includes("${"));
  const inferred = new Set<string>();
  for (const token of tokens) {
    if (!token.includes("${")) {
      if (knownClassNames.includes(token)) {
        inferred.add(token);
      }
      continue;
    }

    const literalTemplateText = token.replace(/\$\{[^}]+\}/g, "");
    if (!hasMeaningfulTemplateLiteralAnchor(literalTemplateText)) {
      for (const className of inferModifierClassNamesFromStaticAnchors(
        staticAnchors,
        knownClassNames,
      )) {
        inferred.add(className);
      }
      continue;
    }

    const escaped = token
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\$\\\{[^}]+\\\}/g, ".*");
    const matcher = new RegExp(`^${escaped}$`);
    for (const className of knownClassNames) {
      if (matcher.test(className)) {
        inferred.add(className);
      }
    }
  }

  return uniqueSorted([...inferred]);
}

function hasMeaningfulTemplateLiteralAnchor(text: string): boolean {
  return /[A-Za-z0-9_]{2,}|-[A-Za-z0-9_]|[A-Za-z0-9_]-/.test(text);
}

function inferModifierClassNamesFromStaticAnchors(
  staticAnchors: string[],
  knownClassNames: string[],
): string[] {
  const matched = new Set<string>();
  for (const anchor of staticAnchors) {
    if (!knownClassNames.includes(anchor)) {
      continue;
    }
    for (const className of knownClassNames) {
      if (
        className.startsWith(`${anchor}-`) ||
        className.startsWith(`${anchor}_`) ||
        className.startsWith(`${anchor}--`) ||
        className.startsWith(`${anchor}__`)
      ) {
        matched.add(className);
      }
    }
  }
  return uniqueSorted([...matched]);
}

export function buildStaticallySkippedClassReferences(input: {
  renderModel: RenderModel;
  symbolicEvaluation: ProjectEvidenceBuildInput["symbolicEvaluation"];
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): StaticallySkippedClassReferenceAnalysis[] {
  if (!input.symbolicEvaluation || !input.factGraph) {
    return [];
  }

  const candidateExpressions = input.symbolicEvaluation.evaluatedExpressions.classExpressions
    .filter(
      (expression) =>
        (expression.classExpressionSiteKind === "jsx-class" ||
          expression.classExpressionSiteKind === "component-prop-class") &&
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
  indexes: ProjectEvidenceBuilderIndexes,
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
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  lookupContext: ClassReferencesLookupContext;
  profiler: ClassReferencesProfiler;
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
    factGraph: ProjectEvidenceBuildInput["factGraph"];
    indexes: ProjectEvidenceBuilderIndexes;
  },
): ProjectEvidenceId | undefined {
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
  factGraph: ProjectEvidenceBuildInput["factGraph"];
  indexes: ProjectEvidenceBuilderIndexes;
  lookupContext: ClassReferencesLookupContext;
  profiler: ClassReferencesProfiler;
}): Record<string, ProjectEvidenceId> | undefined {
  const componentIdsByClassName: Record<string, ProjectEvidenceId> = {};

  for (const provenance of input.emissionSite.tokenProvenance) {
    const sourceLocation = provenance.sourceLocation
      ? normalizeAnchor(provenance.sourceLocation)
      : undefined;
    const sourceSite = sourceLocation
      ? findClassExpressionSiteAtLocation(sourceLocation, input.lookupContext, input.profiler)
      : undefined;
    const sourceLocationComponentId =
      projectComponentNodeId(sourceSite?.emittingComponentNodeId, input) ??
      (sourceLocation
        ? projectComponentAtLocation(sourceLocation, input, input.lookupContext, input.profiler)
        : undefined);
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
  location: SourceAnchor,
  lookupContext: ClassReferencesLookupContext,
  profiler?: ClassReferencesProfiler,
): ClassExpressionSiteLookupResult | undefined {
  const run = () => {
    const cacheKey = toAnchorCacheKey(location);
    const cached = lookupContext.classExpressionSiteLookupCache.get(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const filePath = normalizeProjectPath(location.filePath);
    const candidates = lookupContext.classExpressionSitesByFilePath.get(filePath) ?? [];
    let bestMatch: ClassExpressionSiteLookupEntry | undefined;
    for (const candidate of candidates) {
      const siteLocation = candidate.location;
      if (
        anchorsEqual(siteLocation, location) ||
        sourceAnchorContains(siteLocation, location) ||
        sourceAnchorContains(location, siteLocation)
      ) {
        if (!bestMatch || candidate.span < bestMatch.span) {
          bestMatch = candidate;
        }
      }
    }

    const result = bestMatch
      ? {
          rawExpressionText: bestMatch.rawExpressionText,
          emittingComponentNodeId: bestMatch.emittingComponentNodeId,
        }
      : undefined;
    lookupContext.classExpressionSiteLookupCache.set(cacheKey, result ?? null);
    return result;
  };
  return profiler ? profiler.time("classReferences.findClassExpressionSiteAtLocation", run) : run();
}

function projectComponentAtLocation(
  location: SourceAnchor,
  input: {
    factGraph: ProjectEvidenceBuildInput["factGraph"];
    indexes: ProjectEvidenceBuilderIndexes;
  },
  lookupContext: ClassReferencesLookupContext,
  profiler?: ClassReferencesProfiler,
): ProjectEvidenceId | undefined {
  const run = () => {
    const cacheKey = toAnchorCacheKey(location);
    const cached = lookupContext.componentAtLocationCache.get(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const filePath = normalizeProjectPath(location.filePath);
    const sameFileComponents = lookupContext.componentsByFilePath.get(filePath) ?? [];

    let bestComponent: ComponentLookupEntry | undefined;
    for (const candidate of sameFileComponents) {
      if (sourceAnchorContains(candidate.location, location)) {
        if (!bestComponent || candidate.span < bestComponent.span) {
          bestComponent = candidate;
        }
      }
    }
    if (bestComponent) {
      const resolved = input.indexes.componentIdByComponentKey.get(bestComponent.componentKey);
      lookupContext.componentAtLocationCache.set(cacheKey, resolved ?? null);
      return resolved;
    }

    const resolved =
      sameFileComponents.length === 1
        ? input.indexes.componentIdByComponentKey.get(sameFileComponents[0].componentKey)
        : undefined;
    lookupContext.componentAtLocationCache.set(cacheKey, resolved ?? null);
    return resolved;
  };
  return profiler ? profiler.time("classReferences.projectComponentAtLocation", run) : run();
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

function shouldProjectSymbolicClassReference(expression: CanonicalClassExpression): boolean {
  if (!shouldProjectCanonicalClassExpression(expression)) {
    return false;
  }

  if (
    expression.classExpressionSiteKind === "jsx-class" &&
    (expression.renderSiteNodeId || expression.elementTemplateNodeId)
  ) {
    return false;
  }

  return true;
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
  componentId?: ProjectEvidenceId;
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

function createClassReferencesLookupContext(
  factGraph: ProjectEvidenceBuildInput["factGraph"],
): ClassReferencesLookupContext {
  const classExpressionSitesByFilePath = new Map<string, ClassExpressionSiteLookupEntry[]>();
  for (const site of factGraph?.graph.nodes.classExpressionSites ?? []) {
    const filePath = normalizeProjectPath(site.location.filePath);
    const entries = classExpressionSitesByFilePath.get(filePath) ?? [];
    entries.push({
      location: normalizeAnchor(site.location),
      span: anchorSpan(site.location),
      rawExpressionText: site.rawExpressionText,
      emittingComponentNodeId: site.emittingComponentNodeId,
    });
    classExpressionSitesByFilePath.set(filePath, entries);
  }

  const componentsByFilePath = new Map<string, ComponentLookupEntry[]>();
  for (const component of factGraph?.graph.nodes.components ?? []) {
    const filePath = normalizeProjectPath(component.filePath);
    const entries = componentsByFilePath.get(filePath) ?? [];
    entries.push({
      location: normalizeAnchor(component.location),
      span: anchorSpan(component.location),
      componentKey: component.componentKey,
    });
    componentsByFilePath.set(filePath, entries);
  }

  return {
    classExpressionSitesByFilePath,
    componentsByFilePath,
    classExpressionSiteLookupCache: new Map(),
    componentAtLocationCache: new Map(),
  };
}

function toAnchorCacheKey(anchor: SourceAnchor): string {
  return [
    normalizeProjectPath(anchor.filePath),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}

function createClassReferencesProfiler(enabled: boolean): ClassReferencesProfiler {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  return {
    enabled,
    totals,
    counts,
    time<T>(label: string, run: () => T): T {
      if (!enabled) {
        return run();
      }
      const startedAt = performance.now();
      const result = run();
      const elapsed = performance.now() - startedAt;
      totals.set(label, (totals.get(label) ?? 0) + elapsed);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return result;
    },
    logSummary(): void {
      if (!enabled) {
        return;
      }
      const rows = [...totals.entries()].sort((left, right) => right[1] - left[1]);
      for (const [label, totalMs] of rows) {
        const count = counts.get(label) ?? 0;
        const avgMs = count > 0 ? totalMs / count : 0;
        console.error(
          `[profile:classReferences] ${label}: total=${totalMs.toFixed(1)}ms count=${count} avg=${avgMs.toFixed(3)}ms`,
        );
      }
    },
  };
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
