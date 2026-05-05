import type { ParsedCssSelectorEntry } from "../libraries/selector-parsing/index.js";
import type { SourceAnchor } from "./core.js";

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
  selectorEntries: ParsedCssSelectorEntry[];
  selectorBranches: CssSelectorBranchFact[];
  declarations: CssDeclarationFact[];
  line: number;
  atRuleContext: CssAtRuleContextFact[];
};

export type CssClassDefinitionFact = {
  className: string;
  selector: string;
  selectorBranch: CssSelectorBranchFact;
  sourceAnchor?: SourceAnchor;
  declarations: string[];
  declarationDetails: CssDeclarationFact[];
  line: number;
  atRuleContext: CssAtRuleContextFact[];
};

export type CssClassContextFact = {
  className: string;
  selector: string;
  selectorBranch: CssSelectorBranchFact;
  line: number;
  atRuleContext: CssAtRuleContextFact[];
};
