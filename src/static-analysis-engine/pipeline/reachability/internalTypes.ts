import type { AnalysisTrace } from "../../types/analysis.js";
import type { RenderGraphEdge, RenderGraphNode } from "../render-model/render-graph/types.js";
import type { RenderRegion, RenderSubtree } from "../render-model/render-ir/index.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ReachabilityDerivation, StylesheetReachabilityContextRecord } from "./types.js";
import type { SourceAnchor } from "../../types/core.js";

export type ProjectWideEntrySource = ExternalCssSummary["projectWideEntrySources"][number];

export type UnknownReachabilityBarrier = {
  node:
    | import("../render-model/render-ir/types.js").RenderUnknownNode
    | import("../render-model/render-ir/types.js").RenderComponentReferenceNode;
  path: RenderRegion["path"];
  reason: string;
  sourceAnchor: SourceAnchor;
};

export type PlacedChildRenderRegion = {
  edge: RenderGraphEdge;
  renderRegions: RenderRegion[];
};

export type ReachabilityGraphContext = {
  componentKeys: string[];
  renderRegionsByComponentKey: Map<string, RenderRegion[]>;
  renderRegionsByPathKeyByComponentKey: Map<string, Map<string, RenderRegion[]>>;
  renderSubtreesByComponentKey: Map<string, RenderSubtree>;
  unknownBarriersByComponentKey: Map<string, UnknownReachabilityBarrier[]>;
  placedChildRenderRegionsByComponentKey: Map<string, PlacedChildRenderRegion[]>;
  renderGraphNodesByKey: Map<string, RenderGraphNode>;
  outgoingEdgesByComponentKey: Map<string, RenderGraphEdge[]>;
  incomingEdgesByComponentKey: Map<string, RenderGraphEdge[]>;
  componentKeysByFilePath: Map<string, string[]>;
};

export type ComponentAvailabilityRecord = {
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
};

export type BatchedComponentAvailability = {
  componentAvailabilityByStylesheetPath: Map<string, Map<string, ComponentAvailabilityRecord>>;
};

export type StylesheetImportRecord = {
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};
