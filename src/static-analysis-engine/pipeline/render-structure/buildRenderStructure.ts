import { sortRenderStructureDiagnostics } from "./diagnostics.js";
import { buildRenderModelIndexes } from "./indexes.js";
import { buildNativeRenderStructure } from "./native/buildNativeRenderStructure.js";
import type {
  EmissionSite,
  PlacementCondition,
  RenderGraphProjection,
  RenderPath,
  RenderRegion,
  RenderStructureInput,
  RenderStructureResult,
  RenderedComponent,
  RenderedComponentBoundary,
  RenderedElement,
} from "./types.js";

export function buildRenderStructure(input: RenderStructureInput): RenderStructureResult {
  const projected = buildNativeRenderStructure(input);
  const components: RenderedComponent[] = projected?.components ?? [];
  const componentBoundaries: RenderedComponentBoundary[] = projected?.componentBoundaries ?? [];
  const elements: RenderedElement[] = projected?.elements ?? [];
  const emissionSites: EmissionSite[] = projected?.emissionSites ?? [];
  const renderPaths: RenderPath[] = projected?.renderPaths ?? [];
  const placementConditions: PlacementCondition[] = projected?.placementConditions ?? [];
  const renderRegions: RenderRegion[] = projected?.renderRegions ?? [];
  const renderGraph: RenderGraphProjection = projected?.renderGraph ?? {
    nodes: [],
    edges: [],
  };

  const indexResult = buildRenderModelIndexes({
    components,
    componentBoundaries,
    elements,
    emissionSites,
    renderPaths,
    placementConditions,
    renderRegions,
  });
  const diagnostics = sortRenderStructureDiagnostics([
    ...(projected?.diagnostics ?? []),
    ...indexResult.diagnostics,
  ]);

  return {
    renderModel: {
      meta: {
        generatedAtStage: "render-structure",
        componentCount: components.length,
        componentBoundaryCount: componentBoundaries.length,
        elementCount: elements.length,
        emissionSiteCount: emissionSites.length,
        renderPathCount: renderPaths.length,
        placementConditionCount: placementConditions.length,
        renderRegionCount: renderRegions.length,
        diagnosticCount: diagnostics.length,
      },
      components,
      componentBoundaries,
      elements,
      emissionSites,
      renderPaths,
      placementConditions,
      renderRegions,
      renderGraph,
      diagnostics,
      indexes: indexResult.indexes,
    },
  };
}
