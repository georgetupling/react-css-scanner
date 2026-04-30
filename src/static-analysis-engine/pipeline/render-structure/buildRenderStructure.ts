import { sortRenderStructureDiagnostics } from "./diagnostics.js";
import { buildRenderModelIndexes } from "./indexes.js";
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
  const components: RenderedComponent[] = [];
  const componentBoundaries: RenderedComponentBoundary[] = [];
  const elements: RenderedElement[] = [];
  const emissionSites: EmissionSite[] = [];
  const renderPaths: RenderPath[] = [];
  const placementConditions: PlacementCondition[] = [];
  const renderRegions: RenderRegion[] = [];
  const renderGraph: RenderGraphProjection = {
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
  const diagnostics = sortRenderStructureDiagnostics(indexResult.diagnostics);

  return {
    graph: input.graph,
    symbolicEvaluation: input.symbolicEvaluation,
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
