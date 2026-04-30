import type {
  LegacyRenderArtifacts as RenderModel,
  LegacyRenderArtifactsBuildInput as RenderModelBuildInput,
} from "./buildLegacyRenderArtifacts.js";
import { buildLegacyRenderArtifacts } from "./buildLegacyRenderArtifacts.js";

export type { RenderModel, RenderModelBuildInput };

export function buildRenderModel(input: RenderModelBuildInput): RenderModel {
  return buildLegacyRenderArtifacts(input);
}
