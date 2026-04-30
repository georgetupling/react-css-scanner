import type { RenderStructureDiagnostic, RenderStructureProvenance } from "./types.js";

export function renderStructureProvenance(input: {
  summary: string;
  filePath?: string;
  anchor?: import("../../types/core.js").SourceAnchor;
  upstreamId?: string;
}): RenderStructureProvenance[] {
  return [
    {
      stage: "render-structure",
      summary: input.summary,
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.anchor ? { anchor: input.anchor } : {}),
      ...(input.upstreamId ? { upstreamId: input.upstreamId } : {}),
    },
  ];
}

export function duplicateRenderModelIdDiagnostic(input: {
  id: string;
  recordKind: string;
}): RenderStructureDiagnostic {
  return {
    stage: "render-structure",
    severity: "error",
    code: "duplicate-render-model-id",
    message: `Duplicate ${input.recordKind} id in render model: ${input.id}`,
    provenance: renderStructureProvenance({
      summary: "Detected duplicate render model id",
      upstreamId: input.id,
    }),
    traces: [],
  };
}

export function sortRenderStructureDiagnostics(
  diagnostics: RenderStructureDiagnostic[],
): RenderStructureDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    diagnosticSortKey(left).localeCompare(diagnosticSortKey(right)),
  );
}

function diagnosticSortKey(diagnostic: RenderStructureDiagnostic): string {
  return [
    diagnostic.filePath ?? "",
    diagnostic.location?.startLine ?? 0,
    diagnostic.location?.startColumn ?? 0,
    diagnostic.boundaryId ?? "",
    diagnostic.elementId ?? "",
    diagnostic.emissionSiteId ?? "",
    diagnostic.code,
    diagnostic.message,
  ].join("\0");
}
