import { emissionSiteId, renderPathId } from "../ids.js";
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
  const renderPathById = new Map(input.renderPaths.map((path) => [path.id, path] as const));
  const expressionIdBySiteNodeId =
    input.renderInput.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId;
  const expressionById =
    input.renderInput.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionById;
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

    const element = resolveEmittedElement({
      expression,
      classSite,
      elementIdsByTemplateNodeId,
      elementIdsByRenderSiteNodeId,
      elementsById,
    });
    const boundaryId =
      element?.parentBoundaryId ??
      resolveBoundaryIdForClassSite(classSite, input.rootBoundaryIdByComponentNodeId);

    if (!boundaryId) {
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

    const basePath = element
      ? renderPathById.get(element.renderPathId)
      : findBoundaryRenderPath(boundaryId, input.renderPaths);
    if (!basePath) {
      diagnostics.push(
        buildDiagnostic({
          code: "dangling-render-model-reference",
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
      expression.placementComponentNodeId ?? classSite.placementComponentNodeId;
    const unsupported = [...expression.unsupported].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const confidence =
      unsupported.length > 0 || expression.certainty.kind !== "exact" ? "medium" : "high";

    const emissionSite: EmissionSite = {
      id,
      emissionKind: "rendered-element-class",
      ...(element ? { elementId: element.id } : {}),
      boundaryId,
      classExpressionId: expression.id,
      classExpressionSiteNodeId: expression.classExpressionSiteNodeId,
      sourceExpressionIds: [expression.id],
      sourceLocation: normalizeAnchor(expression.location),
      ...(element ? { emittedElementLocation: normalizeAnchor(element.sourceLocation) } : {}),
      ...(emittedByComponentNodeId ? { emittingComponentNodeId: emittedByComponentNodeId } : {}),
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

    emissionSites.push(emissionSite);
    const instantiatedSite = instantiateExternalContributionEmissionSite({
      emissionSite,
      expression,
      element,
      classSite,
      componentPropSupplies: componentPropSuppliesByBoundaryId.get(boundaryId) ?? [],
      counts: emissionIdCounts,
    });
    if (instantiatedSite) {
      emissionSites.push(instantiatedSite);
      input.renderPaths.push({
        id: instantiatedSite.renderPathId,
        rootComponentNodeId: basePath.rootComponentNodeId,
        terminalKind: "emission-site",
        terminalId: instantiatedSite.id,
        segments: [...basePath.segments],
        placementConditionIds: instantiatedSite.placementConditionIds,
        certainty: basePath.certainty,
        traces: [...instantiatedSite.traces],
      });
    }
    if (element) {
      element.emissionSiteIds = [
        ...new Set([
          ...element.emissionSiteIds,
          id,
          ...(instantiatedSite ? [instantiatedSite.id] : []),
        ]),
      ].sort();
    }
    input.renderPaths.push({
      id: emissionPathId,
      rootComponentNodeId: basePath.rootComponentNodeId,
      terminalKind: "emission-site",
      terminalId: id,
      segments: [...basePath.segments],
      placementConditionIds: emissionSite.placementConditionIds,
      certainty: basePath.certainty,
      traces: [...expression.traces],
    });
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

function resolveEmittedElement(input: {
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  elementIdsByTemplateNodeId: Map<string, string[]>;
  elementIdsByRenderSiteNodeId: Map<string, string[]>;
  elementsById: Map<string, RenderedElement>;
}): RenderedElement | undefined {
  const byTemplate =
    input.expression.elementTemplateNodeId ?? input.classSite.elementTemplateNodeId;
  if (byTemplate) {
    const id = input.elementIdsByTemplateNodeId.get(byTemplate)?.[0];
    if (id) {
      return input.elementsById.get(id);
    }
  }

  const byRenderSite = input.expression.renderSiteNodeId ?? input.classSite.renderSiteNodeId;
  if (byRenderSite) {
    const id = input.elementIdsByRenderSiteNodeId.get(byRenderSite)?.[0];
    if (id) {
      return input.elementsById.get(id);
    }
  }

  return undefined;
}

function resolveBoundaryIdForClassSite(
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number],
  rootBoundaryIdByComponentNodeId: Map<string, string>,
): string | undefined {
  return classSite.emittingComponentNodeId
    ? rootBoundaryIdByComponentNodeId.get(classSite.emittingComponentNodeId)
    : undefined;
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

function instantiateExternalContributionEmissionSite(input: {
  emissionSite: EmissionSite;
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  element?: RenderedElement;
  componentPropSupplies: ComponentPropSupply[];
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
  const instantiatedTokens = [...supply.expression.tokens]
    .filter((token) => token.tokenKind !== "css-module-export")
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
      ...(token.sourceAnchor ? { sourceAnchor: token.sourceAnchor } : {}),
      confidence: token.confidence,
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
    sourceExpressionId: supply.expression.id,
    sourceClassExpressionSiteNodeId: supply.expression.classExpressionSiteNodeId,
    ...(token.sourceAnchor ? { sourceLocation: normalizeAnchor(token.sourceAnchor) } : {}),
    ...(supply.suppliedByComponentNodeId
      ? { suppliedByComponentNodeId: supply.suppliedByComponentNodeId }
      : {}),
    ...(input.emissionSite.emittingComponentNodeId
      ? { emittedByComponentNodeId: input.emissionSite.emittingComponentNodeId }
      : {}),
    conditionId: token.conditionId,
    confidence: token.confidence,
  }));

  return {
    id,
    emissionKind: "instantiated-external-class",
    ...(input.element ? { elementId: input.element.id } : {}),
    boundaryId: input.emissionSite.boundaryId,
    classExpressionId: input.expression.id,
    classExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
    sourceExpressionIds: [input.expression.id, supply.expression.id].sort(),
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
    tokenProvenance,
    tokens: instantiatedTokens,
    emissionVariants: [],
    externalContributions: [...input.expression.externalContributions].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    cssModuleContributions: [],
    unsupported: [],
    confidence: "medium",
    renderPathId: renderPathId({ terminalKind: "emission-site", terminalId: id }),
    placementConditionIds: input.element?.placementConditionIds ?? [],
    traces: [...input.expression.traces],
  };
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
