import type { SourceAnchor } from "../../types/core.js";
import type {
  AnalysisConfidence as SharedAnalysisConfidence,
  AnalysisDecision,
  AnalysisStatus as SharedAnalysisStatus,
  AnalysisTrace,
} from "../../types/analysis.js";
import type {
  ReachabilityAvailability,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type { RenderModel } from "../render-structure/types.js";

export type SemanticOutcome = "match" | "possible-match" | "no-match-under-bounded-analysis";

export type AnalysisStatus = SharedAnalysisStatus;

export type AnalysisConfidence = SharedAnalysisConfidence;

export type SelectorConstraint =
  | {
      kind: "same-node-class-conjunction";
      classNames: string[];
    }
  | {
      kind: "parent-child";
      parentClassName: string;
      childClassName: string;
    }
  | {
      kind: "ancestor-descendant";
      ancestorClassName: string;
      subjectClassName: string;
    }
  | {
      kind: "sibling";
      relation: "adjacent" | "general";
      leftClassName: string;
      rightClassName: string;
    };

export type NormalizedSelectorCombinator =
  | "descendant"
  | "child"
  | "adjacent-sibling"
  | "general-sibling"
  | "same-node"
  | null;

export type NormalizedSelectorSimpleSelector = {
  kind: "class-only";
  requiredClasses: string[];
};

export type NormalizedSelectorStep = {
  combinatorFromPrevious: NormalizedSelectorCombinator;
  selector: NormalizedSelectorSimpleSelector;
};

export type NormalizedSelector =
  | {
      kind: "selector-chain";
      steps: NormalizedSelectorStep[];
    }
  | {
      kind: "unsupported";
      reason: string;
      traces: AnalysisTrace[];
    };

export type SelectorSourceInput = {
  filePath?: string;
  cssText: string;
};

export type CssAtRuleContext = {
  kind: "media";
  queryText: string;
};

export type CssSelectorBranchSource = {
  selectorListText?: string;
  branchIndex?: number;
  branchCount?: number;
  ruleKey?: string;
};

export type ExtractedSelectorQuery = {
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
};

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
