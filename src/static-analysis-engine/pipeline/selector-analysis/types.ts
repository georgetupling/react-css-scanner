import type {
  AnalysisConfidence as SharedAnalysisConfidence,
  AnalysisDecision,
  AnalysisStatus as SharedAnalysisStatus,
  AnalysisTrace,
} from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type {
  CssAtRuleContext,
  CssSelectorBranchSource,
  NormalizedSelector,
  SelectorConstraint,
} from "../../libraries/selector-parsing/queryTypes.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type { RenderModel } from "../render-structure/types.js";
import type { SelectorReachabilityResult } from "../selector-reachability/index.js";
export type {
  CssAtRuleContext,
  CssSelectorBranchSource,
  ExtractedSelectorQuery,
  NormalizedSelector,
  NormalizedSelectorCombinator,
  NormalizedSelectorSimpleSelector,
  NormalizedSelectorStep,
  SelectorConstraint,
  SelectorSourceInput,
} from "../../libraries/selector-parsing/queryTypes.js";

export type SemanticOutcome = "match" | "possible-match" | "no-match-under-bounded-analysis";

export type AnalysisStatus = SharedAnalysisStatus;

export type AnalysisConfidence = SharedAnalysisConfidence;

export type ParsedSelectorQuery = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | ({
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
        atRuleContext?: CssAtRuleContext[];
      } & CssSelectorBranchSource);
  normalizedSelectorText: string;
  normalizedSelector: NormalizedSelector;
  parseNotes: string[];
  parseTraces: AnalysisTrace[];
  constraint:
    | SelectorConstraint
    | {
        kind: "unsupported";
        reason: string;
        traces: AnalysisTrace[];
      };
};

export type SelectorQueryResult = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | ({
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
        atRuleContext?: CssAtRuleContext[];
      } & CssSelectorBranchSource);
  constraint?:
    | SelectorConstraint
    | {
        kind: "unsupported";
        reason: string;
        traces: AnalysisTrace[];
      };
  outcome: SemanticOutcome;
  status: AnalysisStatus;
  confidence: AnalysisConfidence;
  reasons: string[];
  decision: AnalysisDecision;
  reachability?:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        cssFilePath?: string;
        availability: ReachabilityAvailability;
        contexts: StylesheetReachabilityContextRecord[];
        matchedContexts?: StylesheetReachabilityContextRecord[];
        reasons: string[];
      };
};

export type SelectorAnalysisTarget = {
  targetId: string;
  elementIds: string[];
  reachabilityAvailability: Extract<ReachabilityAvailability, "definite" | "possible">;
  reachabilityContexts: StylesheetReachabilityContextRecord[];
};

export type SelectorRenderModelIndex = {
  renderModel: RenderModel;
  componentKeyByNodeId: Map<string, string>;
  componentNodeIdByComponentKey: Map<string, string>;
};

export type SelectorReachabilityEvidence = SelectorReachabilityResult;
