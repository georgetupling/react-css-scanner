import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";

export type AbstractValue =
  | { kind: "unknown"; reason: string }
  | { kind: "string-exact"; value: string }
  | { kind: "string-set"; values: string[]; mutuallyExclusiveGroups?: string[][] }
  | {
      kind: "class-set";
      definite: string[];
      possible: string[];
      mutuallyExclusiveGroups?: string[][];
      unknownDynamic: boolean;
      reason?: string;
    };

export type ClassDerivationStep = {
  sourceAnchor?: SourceAnchor;
  description: string;
};

export type AbstractClassSet = {
  definite: string[];
  possible: string[];
  mutuallyExclusiveGroups: string[][];
  unknownDynamic: boolean;
  derivedFrom: ClassDerivationStep[];
};

export type ClassExpressionSummary = {
  sourceAnchor: SourceAnchor;
  value: AbstractValue;
  classes: AbstractClassSet;
  classNameSourceAnchors?: Record<string, SourceAnchor>;
  sourceText: string;
  traces: AnalysisTrace[];
};
