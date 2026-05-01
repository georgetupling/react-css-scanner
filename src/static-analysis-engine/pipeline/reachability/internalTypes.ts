import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  RenderGraphProjectionEdge,
  RenderGraphProjectionNode,
} from "../render-structure/types.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type {
  ReachabilityDerivation,
  ReachabilityRenderRegionPathSegment,
  StylesheetReachabilityContextRecord,
} from "./types.js";
import type { SourceAnchor } from "../../types/core.js";

export type ProjectWideEntrySource = ExternalCssSummary["projectWideEntrySources"][number];

export type UnknownReachabilityBarrier = {
  path: ReachabilityRenderRegion["path"];
  reason: string;
  sourceAnchor: SourceAnchor;
};

export type PlacedChildRenderRegion = {
  edge: RenderGraphProjectionEdge;
  renderRegions: ReachabilityRenderRegion[];
};

export type ReachabilityRenderRegion = {
  filePath: string;
  componentKey?: string;
  componentName?: string;
  kind: "subtree-root" | "conditional-branch" | "repeated-template" | "unknown-barrier";
  path: ReachabilityRenderRegionPathSegment[];
  sourceAnchor: SourceAnchor;
};

export type ReachabilityGraphContext = {
  componentKeys: string[];
  renderRegionsByComponentKey: Map<string, ReachabilityRenderRegion[]>;
  renderRegionsByPathKeyByComponentKey: Map<string, Map<string, ReachabilityRenderRegion[]>>;
  componentRootsByComponentKey: Map<string, ReachabilityComponentRoot>;
  unknownBarriersByComponentKey: Map<string, UnknownReachabilityBarrier[]>;
  placedChildRenderRegionsByComponentKey: Map<string, PlacedChildRenderRegion[]>;
  renderGraphNodesByKey: Map<string, RenderGraphProjectionNode>;
  outgoingEdgesByComponentKey: Map<string, RenderGraphProjectionEdge[]>;
  incomingEdgesByComponentKey: Map<string, RenderGraphProjectionEdge[]>;
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

export type ReachabilityComponentRoot = {
  filePath: string;
  componentKey?: string;
  componentName: string;
  rootSourceAnchor: SourceAnchor;
  declarationSourceAnchor: SourceAnchor;
};
