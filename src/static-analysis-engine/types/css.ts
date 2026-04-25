export type CssSelectorMatchKind = "standalone" | "compound" | "contextual" | "complex";

export type CssSelectorBranchFact = {
  raw: string;
  matchKind: CssSelectorMatchKind;
  subjectClassNames: string[];
  requiredClassNames: string[];
  contextClassNames: string[];
  negativeClassNames: string[];
  hasCombinators: boolean;
  hasSubjectModifiers: boolean;
  hasUnknownSemantics: boolean;
};

export type CssAtRuleContextFact = {
  name: string;
  params: string;
};

export type CssDeclarationFact = {
  property: string;
  value: string;
};

export type CssStyleRuleFact = {
  selector: string;
  selectorBranches: CssSelectorBranchFact[];
  declarations: CssDeclarationFact[];
  line: number;
  atRuleContext: CssAtRuleContextFact[];
};

export type CssClassDefinitionFact = {
  className: string;
  selector: string;
  selectorBranch: CssSelectorBranchFact;
  declarations: string[];
  declarationDetails: CssDeclarationFact[];
  line: number;
  atRuleContext: CssAtRuleContextFact[];
};
