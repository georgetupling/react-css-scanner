import type { SourceAnchor } from "../../types/core.js";
import type { ReachabilityAvailability } from "../reachability/types.js";

export type SemanticOutcome = "match" | "possible-match" | "no-match-under-bounded-analysis";

export type AnalysisStatus = "resolved" | "unsupported" | "budget-exceeded";

export type AnalysisConfidence = "high" | "medium" | "low";

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
    };

export type SelectorSourceInput = {
  filePath?: string;
  cssText: string;
};

export type CssAtRuleContext = {
  kind: "media";
  queryText: string;
};

export type ExtractedSelectorQuery = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
        atRuleContext?: CssAtRuleContext[];
      };
};

export type ParsedSelectorQuery = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
        atRuleContext?: CssAtRuleContext[];
      };
  normalizedSelectorText: string;
  normalizedSelector: NormalizedSelector;
  parseNotes: string[];
  constraint:
    | SelectorConstraint
    | {
        kind: "unsupported";
        reason: string;
      };
};

export type SelectorQueryResult = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
        atRuleContext?: CssAtRuleContext[];
      };
  constraint?:
    | SelectorConstraint
    | {
        kind: "unsupported";
        reason: string;
      };
  outcome: SemanticOutcome;
  status: AnalysisStatus;
  confidence: AnalysisConfidence;
  reasons: string[];
  reachability?:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        cssFilePath?: string;
        availability: ReachabilityAvailability;
        directlyImportingSourceFilePaths: string[];
        reasons: string[];
      };
};
