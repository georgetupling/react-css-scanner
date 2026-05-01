import type { AnalysisConfidence, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { FactNodeId } from "../fact-graph/index.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/index.js";
import type { SelectorBranchRequirement, SelectorReachabilityStatus } from "./types.js";

export type ProjectSelectorScopedReachability = {
  kind: "css-source";
  cssFilePath?: string;
  availability: ReachabilityAvailability;
  contexts: StylesheetReachabilityContextRecord[];
  matchedContexts: StylesheetReachabilityContextRecord[];
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProjectSelectorBranchProjection = {
  selectorBranchNodeId: FactNodeId;
  selectorNodeId: FactNodeId;
  ruleDefinitionNodeId?: FactNodeId;
  stylesheetNodeId?: FactNodeId;
  selectorText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  location?: SourceAnchor;
  constraint?: SelectorBranchRequirement;
  requirement: SelectorBranchRequirement;
  selectorReachabilityStatus: SelectorReachabilityStatus;
  confidence: AnalysisConfidence;
  reasons: string[];
  traces: AnalysisTrace[];
  scopedReachability?: ProjectSelectorScopedReachability;
};

export type ProjectSelectorQueryProjection = {
  selectorNodeId: FactNodeId;
  stylesheetNodeId?: FactNodeId;
  ruleDefinitionNodeId?: FactNodeId;
  selectorText: string;
  location?: SourceAnchor;
  branchIds: FactNodeId[];
  selectorReachabilityStatuses: SelectorReachabilityStatus[];
  confidence: AnalysisConfidence;
  reasons: string[];
  traces: AnalysisTrace[];
};

export type ProjectSelectorProjectionResult = {
  meta: {
    generatedAtStage: "selector-reachability-project-projection";
    selectorBranchCount: number;
    selectorQueryCount: number;
  };
  selectorBranches: ProjectSelectorBranchProjection[];
  selectorQueries: ProjectSelectorQueryProjection[];
  indexes: {
    branchProjectionBySelectorBranchNodeId: Map<FactNodeId, ProjectSelectorBranchProjection>;
    branchProjectionBySourceKey: Map<string, ProjectSelectorBranchProjection>;
    queryProjectionBySelectorNodeId: Map<FactNodeId, ProjectSelectorQueryProjection>;
    branchProjectionIdsByStylesheetNodeId: Map<FactNodeId, FactNodeId[]>;
  };
};
