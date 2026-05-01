import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { FactNodeId } from "../fact-graph/index.js";
import type {
  EmissionSite,
  EmissionSiteId,
  PlacementConditionId,
  RenderPath,
  RenderPathId,
  RenderRegion,
  RenderRegionId,
  RenderedElement,
  RenderedElementId,
} from "../render-structure/index.js";

export type SelectorReachabilityDiagnosticId = string;
export type SelectorBranchMatchId = string;
export type SelectorElementMatchId = string;

export type SelectorReachabilityResult = {
  meta: SelectorReachabilityMeta;
  selectorBranches: SelectorBranchReachability[];
  elementMatches: SelectorElementMatch[];
  branchMatches: SelectorBranchMatch[];
  diagnostics: SelectorReachabilityDiagnostic[];
  indexes: SelectorReachabilityIndexes;
};

export type SelectorReachabilityMeta = {
  generatedAtStage: "selector-reachability";
  selectorBranchCount: number;
  elementMatchCount: number;
  branchMatchCount: number;
  diagnosticCount: number;
};

export type SelectorReachabilityStatus =
  | "definitely-matchable"
  | "possibly-matchable"
  | "only-matches-in-unknown-context"
  | "not-matchable"
  | "unsupported";

export type SelectorMatchCertainty = "definite" | "possible" | "unknown-context" | "impossible";

export type SelectorBranchReachability = {
  selectorBranchNodeId: FactNodeId;
  selectorNodeId: FactNodeId;
  ruleDefinitionNodeId?: FactNodeId;
  stylesheetNodeId?: FactNodeId;
  branchText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  requirement: SelectorBranchRequirement;
  subject: SelectorSubjectRequirement;
  status: SelectorReachabilityStatus;
  confidence: AnalysisConfidence;
  matchIds: SelectorBranchMatchId[];
  diagnosticIds: SelectorReachabilityDiagnosticId[];
  location?: SourceAnchor;
  traces: AnalysisTrace[];
};

export type SelectorBranchRequirement =
  | {
      kind: "same-node-class-conjunction";
      classNames: string[];
      normalizedSteps: SelectorRequirementStep[];
      parseNotes: string[];
      traces: AnalysisTrace[];
    }
  | {
      kind: "ancestor-descendant";
      ancestorClassName: string;
      subjectClassName: string;
      normalizedSteps: SelectorRequirementStep[];
      parseNotes: string[];
      traces: AnalysisTrace[];
    }
  | {
      kind: "parent-child";
      parentClassName: string;
      childClassName: string;
      normalizedSteps: SelectorRequirementStep[];
      parseNotes: string[];
      traces: AnalysisTrace[];
    }
  | {
      kind: "sibling";
      relation: "adjacent" | "general";
      leftClassName: string;
      rightClassName: string;
      normalizedSteps: SelectorRequirementStep[];
      parseNotes: string[];
      traces: AnalysisTrace[];
    }
  | {
      kind: "unsupported";
      reason: string;
      parseNotes: string[];
      traces: AnalysisTrace[];
    };

export type SelectorRequirementCombinator =
  | "descendant"
  | "child"
  | "adjacent-sibling"
  | "general-sibling"
  | "same-node"
  | null;

export type SelectorRequirementStep = {
  combinatorFromPrevious: SelectorRequirementCombinator;
  requiredClasses: string[];
};

export type SelectorSubjectRequirement = {
  requiredClassNames: string[];
  unsupportedParts: UnsupportedSelectorPart[];
};

export type UnsupportedSelectorPart = {
  reason: string;
  location?: SourceAnchor;
};

export type SelectorBranchMatch = {
  id: SelectorBranchMatchId;
  selectorBranchNodeId: FactNodeId;
  subjectElementId: RenderedElementId;
  elementMatchIds: SelectorElementMatchId[];
  supportingEmissionSiteIds: EmissionSiteId[];
  requiredClassNames: string[];
  matchedClassNames: string[];
  renderPathIds: RenderPathId[];
  placementConditionIds: PlacementConditionId[];
  certainty: SelectorMatchCertainty;
  confidence: AnalysisConfidence;
  traces: AnalysisTrace[];
};

export type SelectorElementMatch = {
  id: SelectorElementMatchId;
  selectorBranchNodeId: FactNodeId;
  elementId: RenderedElementId;
  requirement: SelectorSubjectRequirement;
  matchedClassNames: string[];
  supportingEmissionSiteIds: EmissionSiteId[];
  certainty: SelectorMatchCertainty;
  confidence: AnalysisConfidence;
};

export type SelectorReachabilityDiagnostic = {
  id: SelectorReachabilityDiagnosticId;
  selectorBranchNodeId: FactNodeId;
  severity: "debug" | "warning";
  code: "unsupported-selector-branch";
  message: string;
  location?: SourceAnchor;
  traces: AnalysisTrace[];
};

export type SelectorReachabilityIndexes = {
  branchReachabilityBySelectorBranchNodeId: Map<FactNodeId, SelectorBranchReachability>;
  branchReachabilityBySourceKey: Map<string, SelectorBranchReachability>;
  matchById: Map<SelectorBranchMatchId, SelectorBranchMatch>;
  elementMatchById: Map<SelectorElementMatchId, SelectorElementMatch>;
  renderElementById: Map<RenderedElementId, RenderedElement>;
  emissionSiteById: Map<EmissionSiteId, EmissionSite>;
  renderPathById: Map<RenderPathId, RenderPath>;
  unknownRegionById: Map<RenderRegionId, RenderRegion>;
  matchIdsBySelectorBranchNodeId: Map<FactNodeId, SelectorBranchMatchId[]>;
  matchIdsByElementId: Map<RenderedElementId, SelectorBranchMatchId[]>;
  matchIdsByClassName: Map<string, SelectorBranchMatchId[]>;
  matchIdsByEmissionSiteId: Map<EmissionSiteId, SelectorBranchMatchId[]>;
  matchIdsByRenderPathId: Map<RenderPathId, SelectorBranchMatchId[]>;
  matchIdsByPlacementConditionId: Map<PlacementConditionId, SelectorBranchMatchId[]>;
  renderPathIdsByElementId: Map<RenderedElementId, RenderPathId[]>;
  renderPathIdsByEmissionSiteId: Map<EmissionSiteId, RenderPathId[]>;
  placementConditionIdsByElementId: Map<RenderedElementId, PlacementConditionId[]>;
  placementConditionIdsByEmissionSiteId: Map<EmissionSiteId, PlacementConditionId[]>;
  emissionSiteIdsByElementId: Map<RenderedElementId, EmissionSiteId[]>;
  emissionSiteIdsByToken: Map<string, EmissionSiteId[]>;
  unknownClassElementIds: RenderedElementId[];
  unknownClassEmissionSiteIds: EmissionSiteId[];
  unknownClassEmissionSiteIdsByElementId: Map<RenderedElementId, EmissionSiteId[]>;
  unknownRegionIdsByComponentNodeId: Map<FactNodeId, RenderRegionId[]>;
  unknownRegionIdsByRenderPathId: Map<RenderPathId, RenderRegionId[]>;
  branchIdsByRequiredClassName: Map<string, FactNodeId[]>;
  branchIdsByStylesheetNodeId: Map<FactNodeId, FactNodeId[]>;
  diagnosticIdsBySelectorBranchNodeId: Map<FactNodeId, SelectorReachabilityDiagnosticId[]>;
};
