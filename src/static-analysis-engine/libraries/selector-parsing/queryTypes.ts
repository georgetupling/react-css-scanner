import type { AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";

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
