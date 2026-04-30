import { normalizeIdPart } from "../fact-graph/ids.js";
import type {
  EmissionSiteId,
  PlacementConditionId,
  RenderComponentId,
  RenderedComponentBoundaryId,
  RenderedElementId,
  RenderPathId,
  RenderRegionId,
} from "./types.js";

export function renderedComponentId(componentKey: string): RenderComponentId {
  return `render-component:${normalizeIdPart(componentKey)}`;
}

export function renderedComponentBoundaryId(input: {
  boundaryKind: string;
  key: string;
  index?: number;
}): RenderedComponentBoundaryId {
  return [
    "render-boundary",
    normalizeIdPart(input.boundaryKind),
    normalizeIdPart(input.key),
    input.index ?? 0,
  ].join(":");
}

export function renderedElementId(input: {
  key: string;
  tagName: string;
  index?: number;
}): RenderedElementId {
  return [
    "render-element",
    normalizeIdPart(input.key),
    normalizeIdPart(input.tagName),
    input.index ?? 0,
  ].join(":");
}

export function emissionSiteId(input: {
  classExpressionId: string;
  key: string;
  index?: number;
}): EmissionSiteId {
  return [
    "render-emission",
    normalizeIdPart(input.classExpressionId),
    normalizeIdPart(input.key),
    input.index ?? 0,
  ].join(":");
}

export function renderPathId(input: { terminalKind: string; terminalId: string }): RenderPathId {
  return [
    "render-path",
    normalizeIdPart(input.terminalKind),
    normalizeIdPart(input.terminalId),
  ].join(":");
}

export function placementConditionId(input: {
  conditionKind: string;
  key: string;
  index?: number;
}): PlacementConditionId {
  return [
    "render-condition",
    normalizeIdPart(input.conditionKind),
    normalizeIdPart(input.key),
    input.index ?? 0,
  ].join(":");
}

export function renderRegionId(input: {
  regionKind: string;
  key: string;
  index?: number;
}): RenderRegionId {
  return [
    "render-region",
    normalizeIdPart(input.regionKind),
    normalizeIdPart(input.key),
    input.index ?? 0,
  ].join(":");
}
