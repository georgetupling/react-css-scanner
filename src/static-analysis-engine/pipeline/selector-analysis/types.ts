import type { SourceAnchor } from "../../types/core.js";

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

export type ExtractedSelectorQuery = {
  selectorText: string;
  source:
    | {
        kind: "direct-query";
      }
    | {
        kind: "css-source";
        selectorAnchor?: SourceAnchor;
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
};
