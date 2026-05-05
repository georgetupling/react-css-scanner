import type { AnalysisConfidence, AnalysisSeverity, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { FactGraph, FactNodeId } from "../fact-graph/index.js";
import type {
  ClassEmissionVariant,
  ConditionId,
  CssModuleClassContribution,
  EvaluatedExpressionId,
  ExternalClassContribution,
  SymbolicEvaluationResult,
  TokenAlternative,
  UnsupportedReason,
} from "../symbolic-evaluation/index.js";

export type RenderComponentId = string;
export type RenderedComponentBoundaryId = string;
export type RenderedElementId = string;
export type EmissionSiteId = string;
export type RenderPathId = string;
export type PlacementConditionId = string;
export type RenderRegionId = string;

export type RenderStructureOptions = {
  includeTraces?: boolean;
  maxComponentExpansionDepth?: number;
  maxRenderExpressionDepth?: number;
  maxRepeatedRegionExpansions?: number;
};

export type RenderStructureInput = {
  graph: FactGraph;
  symbolicEvaluation: SymbolicEvaluationResult;
  options?: RenderStructureOptions;
};

export type RenderStructureResult = {
  renderModel: RenderModel;
};

export type RenderModel = {
  meta: RenderModelMeta;
  components: RenderedComponent[];
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
  renderGraph: RenderGraphProjection;
  diagnostics: RenderStructureDiagnostic[];
  indexes: RenderModelIndexes;
};

export type RenderModelMeta = {
  generatedAtStage: "render-structure";
  componentCount: number;
  componentBoundaryCount: number;
  elementCount: number;
  emissionSiteCount: number;
  renderPathCount: number;
  placementConditionCount: number;
  renderRegionCount: number;
  diagnosticCount: number;
};

export type RenderedComponent = {
  id: RenderComponentId;
  componentNodeId?: FactNodeId;
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  declarationLocation: SourceAnchor;
  rootBoundaryIds: RenderedComponentBoundaryId[];
  provenance: RenderStructureProvenance[];
  traces: AnalysisTrace[];
};

export type RenderedComponentBoundary = {
  id: RenderedComponentBoundaryId;
  boundaryKind:
    | "component-root"
    | "expanded-component-reference"
    | "unresolved-component-reference";
  componentNodeId?: FactNodeId;
  componentKey?: string;
  componentName?: string;
  filePath?: string;
  declarationLocation?: SourceAnchor;
  referenceRenderSiteNodeId?: FactNodeId;
  referenceLocation?: SourceAnchor;
  parentBoundaryId?: RenderedComponentBoundaryId;
  parentElementId?: RenderedElementId;
  childBoundaryIds: RenderedComponentBoundaryId[];
  rootElementIds: RenderedElementId[];
  renderPathId: RenderPathId;
  placementConditionIds: PlacementConditionId[];
  expansion:
    | { status: "root" }
    | { status: "expanded"; reason: string }
    | {
        status: "unresolved" | "cycle" | "budget-exceeded" | "unsupported";
        reason: string;
      };
  traces: AnalysisTrace[];
};

export type RenderedElement = {
  id: RenderedElementId;
  tagName: string;
  elementTemplateNodeId?: FactNodeId;
  renderSiteNodeId?: FactNodeId;
  sourceLocation: SourceAnchor;
  parentElementId?: RenderedElementId;
  parentBoundaryId: RenderedComponentBoundaryId;
  childElementIds: RenderedElementId[];
  childBoundaryIds: RenderedComponentBoundaryId[];
  emissionSiteIds: EmissionSiteId[];
  emittingComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  renderPathId: RenderPathId;
  placementConditionIds: PlacementConditionId[];
  certainty: RenderCertainty;
  traces: AnalysisTrace[];
};

export type EmissionSite = {
  id: EmissionSiteId;
  emissionKind:
    | "rendered-element-class"
    | "instantiated-external-class"
    | "merged-element-class"
    | "unresolved-component-class-prop";
  elementId?: RenderedElementId;
  boundaryId: RenderedComponentBoundaryId;
  classExpressionId: EvaluatedExpressionId;
  classExpressionSiteNodeId: FactNodeId;
  sourceExpressionIds: EvaluatedExpressionId[];
  sourceLocation: SourceAnchor;
  emittedElementLocation?: SourceAnchor;
  placementLocation?: SourceAnchor;
  emittingComponentNodeId?: FactNodeId;
  suppliedByComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  tokenProvenance: EmissionTokenProvenance[];
  tokens: TokenAlternative[];
  emissionVariants: ClassEmissionVariant[];
  externalContributions: ExternalClassContribution[];
  cssModuleContributions: CssModuleClassContribution[];
  unsupported: UnsupportedReason[];
  confidence: AnalysisConfidence;
  renderPathId: RenderPathId;
  placementConditionIds: PlacementConditionId[];
  traces: AnalysisTrace[];
};

export type EmissionTokenProvenance = {
  token: string;
  tokenKind: "global-class" | "css-module-export" | "external-class";
  presence: "always" | "conditional" | "possible";
  sourceExpressionId: EvaluatedExpressionId;
  sourceClassExpressionSiteNodeId: FactNodeId;
  sourceLocation?: SourceAnchor;
  suppliedByComponentNodeId?: FactNodeId;
  emittedByComponentNodeId?: FactNodeId;
  conditionId: ConditionId;
  confidence: AnalysisConfidence;
};

export type RenderPath = {
  id: RenderPathId;
  rootComponentNodeId?: FactNodeId;
  terminalKind: "component-boundary" | "element" | "emission-site" | "unknown-region";
  terminalId: string;
  segments: RenderPathSegment[];
  placementConditionIds: PlacementConditionId[];
  certainty: RenderCertainty;
  traces: AnalysisTrace[];
};

export type RenderPathSegment =
  | { kind: "component-root"; componentNodeId?: FactNodeId; location: SourceAnchor }
  | { kind: "component-reference"; renderSiteNodeId?: FactNodeId; location: SourceAnchor }
  | { kind: "element"; elementId: RenderedElementId; tagName: string; location: SourceAnchor }
  | { kind: "child-index"; index: number }
  | {
      kind: "conditional-branch";
      branch: "when-true" | "when-false";
      conditionId: PlacementConditionId;
    }
  | { kind: "repeated-template"; conditionId: PlacementConditionId }
  | { kind: "unknown-barrier"; reason: string; location: SourceAnchor };

export type PlacementCondition = {
  id: PlacementConditionId;
  kind:
    | "always"
    | "conditional-branch"
    | "statically-skipped-branch"
    | "repeated-region"
    | "unknown-barrier";
  sourceText?: string;
  sourceLocation?: SourceAnchor;
  branch?: "when-true" | "when-false";
  reason?: string;
  mayHaveMultipleIterations?: boolean;
  certainty: RenderCertainty;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type RenderRegion = {
  id: RenderRegionId;
  regionKind: "component-root" | "conditional-branch" | "repeated-template" | "unknown-barrier";
  boundaryId: RenderedComponentBoundaryId;
  componentNodeId?: FactNodeId;
  renderPathId: RenderPathId;
  sourceLocation: SourceAnchor;
  placementConditionIds: PlacementConditionId[];
  childElementIds: RenderedElementId[];
  childBoundaryIds: RenderedComponentBoundaryId[];
};

export type RenderGraphProjection = {
  nodes: RenderGraphProjectionNode[];
  edges: RenderGraphProjectionEdge[];
};

export type RenderGraphProjectionNode = {
  componentNodeId?: FactNodeId;
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  sourceLocation: SourceAnchor;
};

export type RenderGraphProjectionEdge = {
  fromComponentNodeId?: FactNodeId;
  fromComponentKey: string;
  fromComponentName: string;
  fromFilePath: string;
  toComponentNodeId?: FactNodeId;
  toComponentKey?: string;
  toComponentName: string;
  toFilePath?: string;
  targetLocation?: SourceAnchor;
  sourceLocation: SourceAnchor;
  resolution: "resolved" | "unresolved";
  traversal: "render-structure";
  renderPath: RenderCertainty;
  traces: AnalysisTrace[];
};

export type RenderModelIndexes = {
  componentsById: Map<RenderComponentId, RenderedComponent>;
  componentIdByComponentNodeId: Map<FactNodeId, RenderComponentId>;
  componentBoundaryById: Map<RenderedComponentBoundaryId, RenderedComponentBoundary>;
  boundaryIdsByComponentNodeId: Map<FactNodeId, RenderedComponentBoundaryId[]>;
  elementById: Map<RenderedElementId, RenderedElement>;
  elementIdsByTemplateNodeId: Map<FactNodeId, RenderedElementId[]>;
  elementIdsByRenderSiteNodeId: Map<FactNodeId, RenderedElementId[]>;
  emissionSiteById: Map<EmissionSiteId, EmissionSite>;
  emissionSiteIdsByClassExpressionId: Map<EvaluatedExpressionId, EmissionSiteId[]>;
  emissionSiteIdsByClassExpressionSiteNodeId: Map<FactNodeId, EmissionSiteId[]>;
  emissionSiteIdsByToken: Map<string, EmissionSiteId[]>;
  emissionSiteIdsByElementId: Map<RenderedElementId, EmissionSiteId[]>;
  emissionSiteIdsByEmittingComponentNodeId: Map<FactNodeId, EmissionSiteId[]>;
  emissionSiteIdsBySuppliedByComponentNodeId: Map<FactNodeId, EmissionSiteId[]>;
  childElementIdsByParentElementId: Map<RenderedElementId, RenderedElementId[]>;
  childBoundaryIdsByParentElementId: Map<RenderedElementId, RenderedComponentBoundaryId[]>;
  ancestorElementIdsByElementId: Map<RenderedElementId, RenderedElementId[]>;
  siblingElementIdsByElementId: Map<RenderedElementId, RenderedElementId[]>;
  renderPathById: Map<RenderPathId, RenderPath>;
  renderRegionIdsByComponentNodeId: Map<FactNodeId, RenderRegionId[]>;
  unknownBarrierRegionIdsByComponentNodeId: Map<FactNodeId, RenderRegionId[]>;
};

export type RenderStructureDiagnostic = {
  stage: "render-structure";
  severity: AnalysisSeverity;
  code:
    | "missing-symbolic-class-expression"
    | "unmodeled-class-expression-site"
    | "unconsumed-component-class-prop"
    | "unresolved-component-reference"
    | "heuristic-component-reference-match"
    | "component-expansion-cycle"
    | "component-expansion-budget-exceeded"
    | "unsupported-component-props"
    | "unsupported-render-syntax"
    | "render-expansion-budget-exceeded"
    | "duplicate-render-structure-id"
    | "dangling-render-structure-reference";
  message: string;
  filePath?: string;
  location?: SourceAnchor;
  renderSiteNodeId?: FactNodeId;
  classExpressionSiteNodeId?: FactNodeId;
  evaluatedExpressionId?: EvaluatedExpressionId;
  boundaryId?: RenderedComponentBoundaryId;
  elementId?: RenderedElementId;
  emissionSiteId?: EmissionSiteId;
  provenance: RenderStructureProvenance[];
  traces: AnalysisTrace[];
};

export type UnsupportedClassReferenceReason = "raw-jsx-class-not-modeled";

export type UnsupportedClassReferenceDiagnostic = {
  sourceAnchor: SourceAnchor;
  rawExpressionText: string;
  reason: UnsupportedClassReferenceReason;
  traces: AnalysisTrace[];
};

export type RenderStructureProvenance = {
  stage: "render-structure";
  filePath?: string;
  anchor?: SourceAnchor;
  upstreamId?: string;
  summary: string;
  traces?: AnalysisTrace[];
};

export type RenderCertainty = "definite" | "possible" | "unknown";
