import { placementConditionId } from "../ids.js";
import type {
  PlacementCondition,
  RenderStructureDiagnostic,
  RenderStructureInput,
} from "../types.js";
import { normalizeAnchor, normalizeProjectPath } from "./common.js";

export function createUnknownBarrierCondition(input: {
  boundaryId: string;
  sourceLocation: RenderStructureInput["graph"]["nodes"]["components"][number]["location"];
  reason: string;
}): PlacementCondition {
  return {
    id: placementConditionId({
      conditionKind: "unknown-barrier",
      key: `${input.boundaryId}:${input.reason}:${input.sourceLocation.filePath}:${input.sourceLocation.startLine}:${input.sourceLocation.startColumn}`,
    }),
    kind: "unknown-barrier",
    sourceLocation: normalizeAnchor(input.sourceLocation),
    reason: input.reason,
    certainty: "unknown",
    confidence: "low",
    traces: [],
  };
}

export function buildDiagnostic(input: {
  code: RenderStructureDiagnostic["code"];
  message: string;
  filePath: string;
  location: RenderStructureInput["graph"]["nodes"]["components"][number]["location"];
  renderSiteNodeId?: string;
  boundaryId?: string;
}): RenderStructureDiagnostic {
  const location = normalizeAnchor(input.location);
  return {
    stage: "render-structure",
    severity: "debug",
    code: input.code,
    message: input.message,
    filePath: normalizeProjectPath(input.filePath),
    location,
    ...(input.renderSiteNodeId ? { renderSiteNodeId: input.renderSiteNodeId } : {}),
    ...(input.boundaryId ? { boundaryId: input.boundaryId } : {}),
    provenance: [
      {
        stage: "render-structure",
        filePath: normalizeProjectPath(input.filePath),
        anchor: location,
        upstreamId: input.renderSiteNodeId,
        summary: input.message,
      },
    ],
    traces: [],
  };
}
