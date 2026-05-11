export type SelectorStepCombinator =
  | "descendant"
  | "child"
  | "adjacent-sibling"
  | "general-sibling"
  | null;

export type ParsedSimpleSelectorSequence = {
  requiredClasses: string[];
  requiredIds: string[];
  classAttributePredicates: ParsedClassAttributePredicate[];
  attributePredicates: ParsedAttributePredicate[];
  negativeClasses: string[];
  contextOnlyClasses: string[];
  hasDescendantClasses: string[];
  hasClassRelations: ParsedHasClassRelation[];
  pseudoClasses: string[];
  hasUnknownSemantics: boolean;
  hasSubjectModifiers: boolean;
  hasTypeOrIdConstraint: boolean;
};

export type ParsedClassAttributePredicate = {
  operator: "prefix" | "suffix" | "substring";
  value: string;
};

export type ParsedAttributePredicate = {
  name: string;
  operator: "exact";
  value: string;
};

export type ParsedHasClassRelation = {
  relation: "descendant" | "child" | "adjacent-sibling" | "general-sibling";
  className: string;
};

export type ParsedSelectorStep = {
  combinatorFromPrevious: SelectorStepCombinator;
  selector: ParsedSimpleSelectorSequence;
};

export type ParsedSelectorBranchMatchKind = "standalone" | "compound" | "contextual" | "complex";

export type ParsedSelectorBranch = {
  raw: string;
  steps: ParsedSelectorStep[];
  subjectStepIndex: number;
  subjectClassNames: string[];
  subjectIds: string[];
  classAttributePredicates: ParsedClassAttributePredicate[];
  attributePredicates: ParsedAttributePredicate[];
  requiredClassNames: string[];
  contextClassNames: string[];
  negativeClassNames: string[];
  hasDescendantClassNames: string[];
  hasCombinators: boolean;
  hasSubjectModifiers: boolean;
  hasUnknownSemantics: boolean;
  matchKind: ParsedSelectorBranchMatchKind;
};

export type ParsedCssAtRuleContext = {
  kind: "media";
  queryText: string;
};

export type ParsedCssSelectorEntry = {
  selectorText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  parsedBranch: ParsedSelectorBranch;
  selectorAnchor?: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  atRuleContext?: ParsedCssAtRuleContext[];
};
