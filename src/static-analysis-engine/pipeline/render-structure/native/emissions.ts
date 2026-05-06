import { emissionSiteId, renderPathId } from "../ids.js";
import { conditionId } from "../../symbolic-evaluation/ids.js";
import type {
  EmissionSite,
  EmissionTokenProvenance,
  RenderPath,
  RenderStructureDiagnostic,
  RenderStructureInput,
  RenderedComponentBoundary,
  RenderedElement,
} from "../types.js";
import { buildElementIdsByRenderSiteNodeId, buildElementIdsByTemplateNodeId } from "./lookups.js";
import { compareAnchors, normalizeAnchor, normalizeProjectPath } from "./common.js";

export function buildNativeEmissionSites(input: {
  renderInput: RenderStructureInput;
  elements: RenderedElement[];
  componentBoundaries: RenderedComponentBoundary[];
  renderPaths: RenderPath[];
  rootBoundaryIdByComponentNodeId: Map<string, string>;
}): { emissionSites: EmissionSite[]; diagnostics: RenderStructureDiagnostic[] } {
  const emissionSites: EmissionSite[] = [];
  const diagnostics: RenderStructureDiagnostic[] = [];
  const emissionIdCounts = new Map<string, number>();
  const elementsById = new Map(input.elements.map((element) => [element.id, element] as const));
  const boundaryById = new Map(
    input.componentBoundaries.map((boundary) => [boundary.id, boundary] as const),
  );
  const renderPathById = new Map(input.renderPaths.map((path) => [path.id, path] as const));
  const expressionIdBySiteNodeId =
    input.renderInput.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId;
  const expressionById =
    input.renderInput.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionById;
  const expressionSyntaxById = new Map(
    input.renderInput.graph.nodes.expressionSyntax.map((expression) => [expression.id, expression]),
  );
  const elementIdsByTemplateNodeId = buildElementIdsByTemplateNodeId(input.elements);
  const elementIdsByRenderSiteNodeId = buildElementIdsByRenderSiteNodeId(input.elements);
  const classSites = [...input.renderInput.graph.nodes.classExpressionSites].sort(
    (left, right) =>
      compareAnchors(left.location, right.location) || left.id.localeCompare(right.id),
  );
  const componentPropSuppliesByBoundaryId = buildComponentPropSuppliesByBoundaryId({
    classSites,
    componentBoundaries: input.componentBoundaries,
    expressionIdBySiteNodeId,
    expressionById,
  });
  const componentBoundariesByReferenceRenderSiteNodeId =
    buildComponentBoundariesByReferenceRenderSiteNodeId(input.componentBoundaries);

  for (const classSite of classSites) {
    const expressionId = expressionIdBySiteNodeId.get(classSite.id);
    if (!expressionId) {
      diagnostics.push(
        buildDiagnostic({
          code: "missing-symbolic-class-expression",
          message: "class expression site has no symbolic evaluation expression",
          classSite,
        }),
      );
      continue;
    }

    const expression = expressionById.get(expressionId);
    if (!expression) {
      diagnostics.push(
        buildDiagnostic({
          code: "missing-symbolic-class-expression",
          message: "symbolic evaluation expression could not be resolved by id",
          classSite,
          evaluatedExpressionId: expressionId,
        }),
      );
      continue;
    }

    const candidateElements = resolveEmittedElements({
      expression,
      classSite,
      elementIdsByTemplateNodeId,
      elementIdsByRenderSiteNodeId,
      elementsById,
    });
    const fallbackBoundaryId = shouldUseBoundaryFallbackForClassSite(classSite)
      ? resolveBoundaryIdForClassSite(classSite, input.rootBoundaryIdByComponentNodeId)
      : undefined;
    const unresolvedComponentTargets =
      classSite.classExpressionSiteKind === "component-prop-class" && classSite.renderSiteNodeId
        ? (componentBoundariesByReferenceRenderSiteNodeId.get(classSite.renderSiteNodeId) ?? [])
        : [];
    const fallbackTargetBoundaryId =
      fallbackBoundaryId &&
      classSite.classExpressionSiteKind === "component-prop-class" &&
      unresolvedComponentTargets.some(
        (target) => target.boundaryKind === "expanded-component-reference",
      )
        ? undefined
        : fallbackBoundaryId;
    const targets: Array<{
      element?: RenderedElement;
      boundaryId: string;
      emissionKind: EmissionSite["emissionKind"];
      emittedElementLocation?: RenderedElement["sourceLocation"];
    }> =
      candidateElements.length > 0
        ? candidateElements.map((element) => ({
            element,
            boundaryId: element.parentBoundaryId,
            emissionKind: "rendered-element-class" as const,
          }))
        : unresolvedComponentTargets.length > 0
          ? unresolvedComponentTargets
              .filter(
                (target) =>
                  target.boundaryKind === "unresolved-component-reference" &&
                  Boolean(target.referenceLocation),
              )
              .map((target) => ({
                element: undefined,
                boundaryId: target.id,
                emissionKind: "unresolved-component-class-prop" as const,
                emittedElementLocation: normalizeAnchor(target.referenceLocation!),
              }))
          : fallbackTargetBoundaryId
            ? [
                {
                  element: undefined,
                  boundaryId: fallbackTargetBoundaryId,
                  emissionKind: "rendered-element-class" as const,
                },
              ]
            : [];

    if (targets.length === 0) {
      diagnostics.push(
        buildDiagnostic({
          code: "unmodeled-class-expression-site",
          message:
            "class expression site could not be mapped to an emitted element or component boundary",
          classSite,
          evaluatedExpressionId: expression.id,
        }),
      );
      continue;
    }

    for (const target of targets) {
      const element = target.element;
      const boundaryId = target.boundaryId;
      const basePath = element
        ? renderPathById.get(element.renderPathId)
        : findBoundaryRenderPath(boundaryId, input.renderPaths);
      if (!basePath) {
        diagnostics.push(
          buildDiagnostic({
            code: "dangling-render-structure-reference",
            message: "class expression site resolved to a missing render path",
            classSite,
            evaluatedExpressionId: expression.id,
            boundaryId,
            ...(element ? { elementId: element.id } : {}),
          }),
        );
        continue;
      }

      const siteKey = `${classSite.id}:${element?.id ?? boundaryId}`;
      const id = createEmissionSiteId({
        classExpressionId: expression.id,
        key: siteKey,
        counts: emissionIdCounts,
      });
      const emissionPathId = renderPathId({ terminalKind: "emission-site", terminalId: id });
      const emittedByComponentNodeId =
        expression.emittingComponentNodeId ?? classSite.emittingComponentNodeId;
      const placementComponentNodeId =
        element?.placementComponentNodeId ??
        expression.placementComponentNodeId ??
        classSite.placementComponentNodeId;
      const unsupported = [...expression.unsupported].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const confidence =
        unsupported.length > 0 || expression.certainty.kind !== "exact" ? "medium" : "high";

      const emissionSite: EmissionSite = {
        id,
        emissionKind: target.emissionKind,
        ...(element ? { elementId: element.id } : {}),
        boundaryId,
        classExpressionId: expression.id,
        classExpressionSiteNodeId: expression.classExpressionSiteNodeId,
        sourceExpressionIds: [expression.id],
        sourceLocation: normalizeAnchor(expression.location),
        ...(target.emittedElementLocation
          ? { emittedElementLocation: normalizeAnchor(target.emittedElementLocation) }
          : element
            ? { emittedElementLocation: normalizeAnchor(element.sourceLocation) }
            : {}),
        ...(emittedByComponentNodeId ? { emittingComponentNodeId: emittedByComponentNodeId } : {}),
        ...(emittedByComponentNodeId
          ? { suppliedByComponentNodeId: emittedByComponentNodeId }
          : {}),
        ...(placementComponentNodeId ? { placementComponentNodeId } : {}),
        tokenProvenance: buildTokenProvenanceFromExpressionTokens({
          expression,
          emittedByComponentNodeId,
        }),
        tokens: [...expression.tokens].sort(compareTokens),
        emissionVariants: [...expression.emissionVariants].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        externalContributions: [...expression.externalContributions].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        cssModuleContributions: [...expression.cssModuleContributions].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        unsupported,
        confidence,
        renderPathId: emissionPathId,
        placementConditionIds: element?.placementConditionIds ?? [],
        traces: [...expression.traces],
      };

      const instantiatedSite = instantiateExternalContributionEmissionSite({
        emissionSite,
        expression,
        element,
        classSite,
        boundaryById,
        componentPropSupplies: componentPropSuppliesByBoundaryId.get(boundaryId) ?? [],
        componentPropSuppliesByBoundaryId,
        counts: emissionIdCounts,
      });
      const renderPropCallbackSite = instantiateRenderPropCallbackEmissionSite({
        emissionSite,
        expression,
        classSite,
        element,
        boundaryById,
        renderSitesById: input.renderInput.graph.indexes.nodesById,
        renderPropInvocations: input.renderInput.graph.nodes.renderPropInvocations,
        expressionSyntaxById,
        counts: emissionIdCounts,
      });
      const finalEmissionSite = renderPropCallbackSite
        ? {
            ...renderPropCallbackSite,
            id: emissionSite.id,
            renderPathId: emissionSite.renderPathId,
          }
        : instantiatedSite
          ? {
              ...instantiatedSite,
              id: emissionSite.id,
              renderPathId: emissionSite.renderPathId,
            }
          : emissionSite;
      emissionSites.push(finalEmissionSite);
      if (element) {
        element.emissionSiteIds = [...new Set([...element.emissionSiteIds, id])].sort();
      }
      input.renderPaths.push({
        id: emissionPathId,
        rootComponentNodeId: basePath.rootComponentNodeId,
        terminalKind: "emission-site",
        terminalId: id,
        segments: [...basePath.segments],
        placementConditionIds: finalEmissionSite.placementConditionIds,
        certainty: basePath.certainty,
        traces: [...finalEmissionSite.traces],
      });
    }
  }

  for (const [boundaryId, supplies] of componentPropSuppliesByBoundaryId.entries()) {
    for (const supply of supplies) {
      if (supply.consumed) {
        continue;
      }
      diagnostics.push(
        buildDiagnostic({
          code: "unconsumed-component-class-prop",
          message: "component class prop was supplied but not consumed by expanded child render",
          classSite: supply.classSite,
          evaluatedExpressionId: supply.expression.id,
          boundaryId,
        }),
      );
    }
  }

  return { emissionSites, diagnostics };
}

type ComponentPropSupply = {
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  suppliedByComponentNodeId?: string;
  componentPropName?: string;
  consumed: boolean;
};

type ExternalSupplyToken = {
  token: string;
  presence: "always" | "conditional" | "possible";
  sourceAnchor?: NonNullable<
    RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number]["sourceAnchor"]
  >;
  confidence: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number]["confidence"];
  sourceExpressionId: string;
  sourceClassExpressionSiteNodeId: string;
  suppliedByComponentNodeId?: string;
};

function createEmissionSiteId(input: {
  classExpressionId: string;
  key: string;
  counts: Map<string, number>;
}): string {
  const countKey = `${input.classExpressionId}:${input.key}`;
  const index = input.counts.get(countKey) ?? 0;
  input.counts.set(countKey, index + 1);
  return emissionSiteId({
    classExpressionId: input.classExpressionId,
    key: input.key,
    index,
  });
}

function resolveEmittedElements(input: {
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  elementIdsByTemplateNodeId: Map<string, string[]>;
  elementIdsByRenderSiteNodeId: Map<string, string[]>;
  elementsById: Map<string, RenderedElement>;
}): RenderedElement[] {
  const expectedPlacementComponentNodeId =
    input.expression.placementComponentNodeId ?? input.classSite.placementComponentNodeId;
  const expectedEmittingComponentNodeId =
    input.expression.emittingComponentNodeId ?? input.classSite.emittingComponentNodeId;
  const chooseCandidates = (candidateIds: string[]): RenderedElement[] => {
    const candidates = candidateIds
      .map((id) => input.elementsById.get(id))
      .filter((element): element is RenderedElement => Boolean(element));
    if (candidates.length === 0) {
      return [];
    }
    return [...candidates].sort((left, right) => {
      const leftPlacementScore =
        expectedPlacementComponentNodeId &&
        left.placementComponentNodeId === expectedPlacementComponentNodeId
          ? 1
          : 0;
      const rightPlacementScore =
        expectedPlacementComponentNodeId &&
        right.placementComponentNodeId === expectedPlacementComponentNodeId
          ? 1
          : 0;
      if (leftPlacementScore !== rightPlacementScore) {
        return rightPlacementScore - leftPlacementScore;
      }
      const leftEmittingScore =
        expectedEmittingComponentNodeId &&
        left.emittingComponentNodeId === expectedEmittingComponentNodeId
          ? 1
          : 0;
      const rightEmittingScore =
        expectedEmittingComponentNodeId &&
        right.emittingComponentNodeId === expectedEmittingComponentNodeId
          ? 1
          : 0;
      if (leftEmittingScore !== rightEmittingScore) {
        return rightEmittingScore - leftEmittingScore;
      }
      return left.id.localeCompare(right.id);
    });
  };

  const byTemplate =
    input.expression.elementTemplateNodeId ?? input.classSite.elementTemplateNodeId;
  if (byTemplate) {
    const candidates = input.elementIdsByTemplateNodeId.get(byTemplate) ?? [];
    const elements = chooseCandidates(candidates);
    if (elements.length > 0) {
      return elements;
    }
  }

  const byRenderSite = input.expression.renderSiteNodeId ?? input.classSite.renderSiteNodeId;
  if (byRenderSite) {
    const candidates = input.elementIdsByRenderSiteNodeId.get(byRenderSite) ?? [];
    const elements = chooseCandidates(candidates);
    if (elements.length > 0) {
      return elements;
    }
  }

  return [];
}

function resolveBoundaryIdForClassSite(
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number],
  rootBoundaryIdByComponentNodeId: Map<string, string>,
): string | undefined {
  return classSite.emittingComponentNodeId
    ? rootBoundaryIdByComponentNodeId.get(classSite.emittingComponentNodeId)
    : undefined;
}

function shouldUseBoundaryFallbackForClassSite(
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number],
): boolean {
  return (
    classSite.classExpressionSiteKind !== "jsx-class" ||
    (!classSite.renderSiteNodeId && !classSite.elementTemplateNodeId)
  );
}

function buildComponentPropSuppliesByBoundaryId(input: {
  classSites: RenderStructureInput["graph"]["nodes"]["classExpressionSites"];
  componentBoundaries: RenderedComponentBoundary[];
  expressionIdBySiteNodeId: Map<string, string>;
  expressionById: Map<
    string,
    RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]
  >;
}): Map<string, ComponentPropSupply[]> {
  const sitesByRenderSiteId = new Map<
    string,
    RenderStructureInput["graph"]["nodes"]["classExpressionSites"]
  >();
  for (const classSite of input.classSites) {
    if (
      classSite.classExpressionSiteKind !== "component-prop-class" ||
      !classSite.renderSiteNodeId
    ) {
      continue;
    }
    const existing = sitesByRenderSiteId.get(classSite.renderSiteNodeId) ?? [];
    existing.push(classSite);
    sitesByRenderSiteId.set(classSite.renderSiteNodeId, existing);
  }

  const result = new Map<string, ComponentPropSupply[]>();
  for (const boundary of input.componentBoundaries) {
    if (!boundary.referenceRenderSiteNodeId) {
      continue;
    }
    const sites = sitesByRenderSiteId.get(boundary.referenceRenderSiteNodeId) ?? [];
    const supplies: ComponentPropSupply[] = [];
    for (const classSite of sites) {
      const expressionId = input.expressionIdBySiteNodeId.get(classSite.id);
      if (!expressionId) {
        continue;
      }
      const expression = input.expressionById.get(expressionId);
      if (!expression) {
        continue;
      }
      supplies.push({
        classSite,
        expression,
        suppliedByComponentNodeId:
          expression.emittingComponentNodeId ?? classSite.emittingComponentNodeId,
        componentPropName: classSite.componentPropName,
        consumed: false,
      });
    }
    if (supplies.length > 0) {
      result.set(
        boundary.id,
        supplies.sort((a, b) => a.expression.id.localeCompare(b.expression.id)),
      );
    }
  }

  return result;
}

function buildComponentBoundariesByReferenceRenderSiteNodeId(
  componentBoundaries: RenderedComponentBoundary[],
): Map<string, RenderedComponentBoundary[]> {
  const result = new Map<string, RenderedComponentBoundary[]>();
  for (const boundary of componentBoundaries) {
    if (boundary.referenceRenderSiteNodeId) {
      const existing = result.get(boundary.referenceRenderSiteNodeId) ?? [];
      existing.push(boundary);
      result.set(boundary.referenceRenderSiteNodeId, existing);
    }
  }
  for (const [renderSiteNodeId, boundaries] of result.entries()) {
    result.set(
      renderSiteNodeId,
      boundaries.sort((left, right) => left.id.localeCompare(right.id)),
    );
  }
  return result;
}

function instantiateExternalContributionEmissionSite(input: {
  emissionSite: EmissionSite;
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  element?: RenderedElement;
  boundaryById: Map<string, RenderedComponentBoundary>;
  componentPropSupplies: ComponentPropSupply[];
  componentPropSuppliesByBoundaryId: Map<string, ComponentPropSupply[]>;
  counts: Map<string, number>;
}): EmissionSite | undefined {
  if (
    input.expression.externalContributions.length === 0 ||
    input.componentPropSupplies.length === 0
  ) {
    return undefined;
  }

  const fallbackSupply = input.componentPropSupplies.find((candidate) => !candidate.consumed);
  const contributionPropNames = new Set(
    input.expression.externalContributions
      .map((contribution) => contribution.propertyName ?? contribution.localName)
      .filter((name): name is string => Boolean(name)),
  );
  const matchedSupply =
    contributionPropNames.size > 0
      ? input.componentPropSupplies.find(
          (candidate) =>
            !candidate.consumed &&
            candidate.componentPropName &&
            contributionPropNames.has(candidate.componentPropName),
        )
      : undefined;
  const supply = matchedSupply ?? fallbackSupply;
  if (!supply) {
    return undefined;
  }
  supply.consumed = true;

  const fallbackConditionId =
    input.expression.externalContributions[0]?.conditionId ??
    input.expression.tokens[0]?.conditionId ??
    supply.expression.tokens[0]?.conditionId;
  if (!fallbackConditionId) {
    return undefined;
  }

  const known = new Set(input.expression.tokens.map((token) => token.token));
  const supplyTokens = collectExternalSupplyTokens({
    supply,
    boundaryId: input.emissionSite.boundaryId,
    boundaryById: input.boundaryById,
    componentPropSuppliesByBoundaryId: input.componentPropSuppliesByBoundaryId,
    seenExpressionIds: new Set(),
  });
  const instantiatedTokens = supplyTokens
    .filter((token) => {
      if (known.has(token.token)) {
        return false;
      }
      known.add(token.token);
      return true;
    })
    .map((token, index) => ({
      id: `${input.expression.id}:instantiated-external:${supply.expression.id}:${index}`,
      token: token.token,
      tokenKind: "external-class" as const,
      presence: token.presence,
      conditionId: fallbackConditionId,
      ...(token.sourceAnchor ? { sourceAnchor: normalizeAnchor(token.sourceAnchor) } : {}),
      confidence: token.confidence,
      sourceExpressionId: token.sourceExpressionId,
      sourceClassExpressionSiteNodeId: token.sourceClassExpressionSiteNodeId,
      ...(token.suppliedByComponentNodeId
        ? { suppliedByComponentNodeId: token.suppliedByComponentNodeId }
        : {}),
      ...(input.expression.externalContributions[0]
        ? { contributionId: input.expression.externalContributions[0].id }
        : {}),
    }))
    .sort(compareTokens);

  if (instantiatedTokens.length === 0) {
    return undefined;
  }

  const siteKey = `${input.classSite.id}:${input.element?.id ?? input.emissionSite.boundaryId}:instantiated:${supply.expression.id}`;
  const id = createEmissionSiteId({
    classExpressionId: input.expression.id,
    key: siteKey,
    counts: input.counts,
  });

  const tokenProvenance: EmissionTokenProvenance[] = instantiatedTokens.map((token) => ({
    token: token.token,
    tokenKind: token.tokenKind,
    presence: token.presence,
    sourceExpressionId: token.sourceExpressionId,
    sourceClassExpressionSiteNodeId: token.sourceClassExpressionSiteNodeId,
    ...(token.sourceAnchor ? { sourceLocation: normalizeAnchor(token.sourceAnchor) } : {}),
    ...(token.suppliedByComponentNodeId
      ? { suppliedByComponentNodeId: token.suppliedByComponentNodeId }
      : {}),
    ...(input.emissionSite.emittingComponentNodeId
      ? { emittedByComponentNodeId: input.emissionSite.emittingComponentNodeId }
      : {}),
    conditionId: token.conditionId,
    confidence: token.confidence,
  }));

  return {
    id,
    emissionKind: "merged-element-class",
    ...(input.element ? { elementId: input.element.id } : {}),
    boundaryId: input.emissionSite.boundaryId,
    classExpressionId: input.expression.id,
    classExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
    sourceExpressionIds: [
      input.expression.id,
      supply.expression.id,
      ...supplyTokens.map((token) => token.sourceExpressionId),
    ].sort(),
    sourceLocation: normalizeAnchor(input.expression.location),
    ...(input.element
      ? { emittedElementLocation: normalizeAnchor(input.element.sourceLocation) }
      : {}),
    ...(input.emissionSite.placementLocation
      ? { placementLocation: input.emissionSite.placementLocation }
      : {}),
    ...(input.emissionSite.emittingComponentNodeId
      ? { emittingComponentNodeId: input.emissionSite.emittingComponentNodeId }
      : {}),
    ...(supply.suppliedByComponentNodeId
      ? { suppliedByComponentNodeId: supply.suppliedByComponentNodeId }
      : {}),
    ...(input.emissionSite.placementComponentNodeId
      ? { placementComponentNodeId: input.emissionSite.placementComponentNodeId }
      : {}),
    tokenProvenance: [...input.emissionSite.tokenProvenance, ...tokenProvenance].sort(
      compareTokenProvenance,
    ),
    tokens: [...input.emissionSite.tokens, ...instantiatedTokens].sort(compareTokens),
    emissionVariants: [...input.emissionSite.emissionVariants].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    externalContributions: [...input.expression.externalContributions].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    cssModuleContributions: [...input.emissionSite.cssModuleContributions].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    unsupported: [],
    confidence: "medium",
    renderPathId: renderPathId({ terminalKind: "emission-site", terminalId: id }),
    placementConditionIds: input.element?.placementConditionIds ?? [],
    traces: [...input.expression.traces],
  };
}

function collectExternalSupplyTokens(input: {
  supply: ComponentPropSupply;
  boundaryId: string;
  boundaryById: Map<string, RenderedComponentBoundary>;
  componentPropSuppliesByBoundaryId: Map<string, ComponentPropSupply[]>;
  seenExpressionIds: Set<string>;
}): ExternalSupplyToken[] {
  if (input.seenExpressionIds.has(input.supply.expression.id)) {
    return [];
  }

  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.supply.expression.id);
  const directTokens: ExternalSupplyToken[] = input.supply.expression.tokens
    .filter((token) => token.tokenKind !== "css-module-export")
    .map((token) => ({
      token: token.token,
      presence: token.presence,
      ...(token.sourceAnchor ? { sourceAnchor: normalizeAnchor(token.sourceAnchor) } : {}),
      confidence: token.confidence,
      sourceExpressionId: input.supply.expression.id,
      sourceClassExpressionSiteNodeId: input.supply.expression.classExpressionSiteNodeId,
      ...(input.supply.suppliedByComponentNodeId
        ? { suppliedByComponentNodeId: input.supply.suppliedByComponentNodeId }
        : {}),
    }));

  const parentBoundaryId = input.boundaryById.get(input.boundaryId)?.parentBoundaryId;
  if (!parentBoundaryId || input.supply.expression.externalContributions.length === 0) {
    return directTokens;
  }

  const upstreamSupplies = input.componentPropSuppliesByBoundaryId.get(parentBoundaryId) ?? [];
  const upstreamTokens: ExternalSupplyToken[] = [];
  for (const contribution of input.supply.expression.externalContributions) {
    const propName = contribution.propertyName ?? contribution.localName;
    if (!propName) {
      continue;
    }

    const upstreamSupply = upstreamSupplies.find(
      (candidate) => candidate.componentPropName === propName,
    );
    if (!upstreamSupply) {
      continue;
    }

    upstreamSupply.consumed = true;
    upstreamTokens.push(
      ...collectExternalSupplyTokens({
        supply: upstreamSupply,
        boundaryId: parentBoundaryId,
        boundaryById: input.boundaryById,
        componentPropSuppliesByBoundaryId: input.componentPropSuppliesByBoundaryId,
        seenExpressionIds,
      }),
    );
  }

  return [...directTokens, ...upstreamTokens];
}

function instantiateRenderPropCallbackEmissionSite(input: {
  emissionSite: EmissionSite;
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  element?: RenderedElement;
  boundaryById: Map<string, RenderedComponentBoundary>;
  renderSitesById: RenderStructureInput["graph"]["indexes"]["nodesById"];
  renderPropInvocations: RenderStructureInput["graph"]["nodes"]["renderPropInvocations"];
  expressionSyntaxById: Map<
    string,
    RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number]
  >;
  counts: Map<string, number>;
}): EmissionSite | undefined {
  if (
    input.expression.tokens.length > 0 ||
    input.classSite.classExpressionSiteKind !== "jsx-class"
  ) {
    return undefined;
  }

  const renderSite = input.classSite.renderSiteNodeId
    ? input.renderSitesById.get(input.classSite.renderSiteNodeId)
    : undefined;
  if (
    !renderSite ||
    renderSite.kind !== "render-site" ||
    !renderSite.callbackPropName ||
    !renderSite.callbackParameterNames?.length
  ) {
    return undefined;
  }

  const parameterIndex = renderSite.callbackParameterNames.indexOf(
    input.classSite.rawExpressionText,
  );
  if (parameterIndex < 0 || !renderSite.parentRenderSiteNodeId) {
    return undefined;
  }

  const boundary = [...input.boundaryById.values()].find(
    (candidate) => candidate.referenceRenderSiteNodeId === renderSite.parentRenderSiteNodeId,
  );
  if (!boundary?.componentNodeId) {
    return undefined;
  }

  const invocation = input.renderPropInvocations.find(
    (candidate) =>
      candidate.componentNodeId === boundary.componentNodeId &&
      candidate.propName === renderSite.callbackPropName,
  );
  const argumentExpressionId = invocation?.argumentExpressionNodeIds[parameterIndex];
  if (!invocation || !argumentExpressionId) {
    return undefined;
  }

  const sourceExpression = input.expressionSyntaxById.get(argumentExpressionId);
  if (!sourceExpression) {
    return undefined;
  }

  const classNames = collectStaticClassNamesFromExpressionSyntax({
    expressionId: argumentExpressionId,
    expressionSyntaxById: input.expressionSyntaxById,
    seen: new Set(),
  });
  if (classNames.length === 0) {
    return undefined;
  }

  const suppliedByComponentNodeId = boundary.parentBoundaryId
    ? (input.boundaryById.get(boundary.parentBoundaryId)?.componentNodeId ??
      input.emissionSite.suppliedByComponentNodeId)
    : input.emissionSite.suppliedByComponentNodeId;
  const fallbackConditionId =
    input.expression.tokens[0]?.conditionId ??
    conditionId({ expressionId: input.expression.id, conditionKey: "render-prop-callback" });
  const tokens = classNames
    .map((className, index) => ({
      id: `${input.expression.id}:render-prop-callback:${invocation.id}:${index}`,
      token: className,
      tokenKind: "external-class" as const,
      presence: "possible" as const,
      conditionId: fallbackConditionId,
      sourceAnchor: normalizeAnchor(sourceExpression.location),
      confidence: "medium" as const,
    }))
    .sort(compareTokens);
  const tokenProvenance: EmissionTokenProvenance[] = tokens.map((token) => ({
    token: token.token,
    tokenKind: token.tokenKind,
    presence: token.presence,
    sourceExpressionId: input.expression.id,
    sourceClassExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
    sourceLocation: token.sourceAnchor,
    ...(suppliedByComponentNodeId ? { suppliedByComponentNodeId } : {}),
    ...(input.emissionSite.emittingComponentNodeId
      ? { emittedByComponentNodeId: input.emissionSite.emittingComponentNodeId }
      : {}),
    conditionId: token.conditionId,
    confidence: token.confidence,
  }));

  const siteKey = `${input.classSite.id}:${input.element?.id ?? input.emissionSite.boundaryId}:render-prop:${invocation.id}`;
  const id = createEmissionSiteId({
    classExpressionId: input.expression.id,
    key: siteKey,
    counts: input.counts,
  });

  return {
    ...input.emissionSite,
    id,
    emissionKind: "instantiated-external-class",
    ...(suppliedByComponentNodeId ? { suppliedByComponentNodeId } : {}),
    tokenProvenance,
    tokens,
    sourceExpressionIds: [input.expression.id, argumentExpressionId].sort(),
    unsupported: [],
    confidence: "medium",
    renderPathId: renderPathId({ terminalKind: "emission-site", terminalId: id }),
  };
}

function collectStaticClassNamesFromExpressionSyntax(input: {
  expressionId: string;
  expressionSyntaxById: Map<
    string,
    RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number]
  >;
  seen: Set<string>;
}): string[] {
  if (input.seen.has(input.expressionId)) {
    return [];
  }
  const seen = new Set(input.seen);
  seen.add(input.expressionId);
  const expression = input.expressionSyntaxById.get(input.expressionId);
  if (!expression) {
    return [];
  }

  if (expression.expressionKind === "string-literal") {
    return splitClassNames(expression.value);
  }
  if (expression.expressionKind === "identifier" && expression.possibleStringValues?.length) {
    return expression.possibleStringValues.flatMap(splitClassNames).sort();
  }
  if (expression.expressionKind === "template-literal" && expression.spans.length === 0) {
    return splitClassNames(expression.headText);
  }
  if (expression.expressionKind === "conditional") {
    return [
      ...collectStaticClassNamesFromExpressionSyntax({
        expressionId: expression.whenTrueExpressionId,
        expressionSyntaxById: input.expressionSyntaxById,
        seen,
      }),
      ...collectStaticClassNamesFromExpressionSyntax({
        expressionId: expression.whenFalseExpressionId,
        expressionSyntaxById: input.expressionSyntaxById,
        seen,
      }),
    ].sort();
  }
  if (expression.expressionKind === "wrapper") {
    return collectStaticClassNamesFromExpressionSyntax({
      expressionId: expression.innerExpressionId,
      expressionSyntaxById: input.expressionSyntaxById,
      seen,
    });
  }

  return [];
}

function splitClassNames(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function findBoundaryRenderPath(
  boundaryId: string,
  renderPaths: RenderPath[],
): RenderPath | undefined {
  return renderPaths.find(
    (path) => path.terminalKind === "component-boundary" && path.terminalId === boundaryId,
  );
}

function buildTokenProvenanceFromExpressionTokens(input: {
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  emittedByComponentNodeId?: string;
}): EmissionTokenProvenance[] {
  return [...input.expression.tokens].sort(compareTokens).map((token) => ({
    token: token.token,
    tokenKind: token.tokenKind,
    presence: token.presence,
    sourceExpressionId: input.expression.id,
    sourceClassExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
    ...(token.sourceAnchor ? { sourceLocation: normalizeAnchor(token.sourceAnchor) } : {}),
    ...(input.emittedByComponentNodeId
      ? { emittedByComponentNodeId: input.emittedByComponentNodeId }
      : {}),
    conditionId: token.conditionId,
    confidence: token.confidence,
  }));
}

function compareTokens(
  left: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number],
  right: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number],
): number {
  return (
    left.token.localeCompare(right.token) ||
    left.tokenKind.localeCompare(right.tokenKind) ||
    left.presence.localeCompare(right.presence) ||
    left.id.localeCompare(right.id)
  );
}

function compareTokenProvenance(
  left: EmissionTokenProvenance,
  right: EmissionTokenProvenance,
): number {
  return (
    left.token.localeCompare(right.token) ||
    left.tokenKind.localeCompare(right.tokenKind) ||
    left.presence.localeCompare(right.presence) ||
    left.sourceExpressionId.localeCompare(right.sourceExpressionId) ||
    left.sourceClassExpressionSiteNodeId.localeCompare(right.sourceClassExpressionSiteNodeId)
  );
}

function buildDiagnostic(input: {
  code: RenderStructureDiagnostic["code"];
  message: string;
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  evaluatedExpressionId?: string;
  boundaryId?: string;
  elementId?: string;
}): RenderStructureDiagnostic {
  const location = normalizeAnchor(input.classSite.location);
  return {
    stage: "render-structure",
    severity: "warning",
    code: input.code,
    message: input.message,
    filePath: normalizeProjectPath(input.classSite.filePath),
    location,
    classExpressionSiteNodeId: input.classSite.id,
    ...(input.evaluatedExpressionId ? { evaluatedExpressionId: input.evaluatedExpressionId } : {}),
    ...(input.boundaryId ? { boundaryId: input.boundaryId } : {}),
    ...(input.elementId ? { elementId: input.elementId } : {}),
    provenance: [
      {
        stage: "render-structure",
        filePath: normalizeProjectPath(input.classSite.filePath),
        anchor: location,
        upstreamId: input.classSite.id,
        summary: input.message,
      },
    ],
    traces: [],
  };
}
