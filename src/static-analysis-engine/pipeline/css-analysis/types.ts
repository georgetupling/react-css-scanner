import type {
  CssAtRuleContextFact,
  CssClassContextFact,
  CssClassDefinitionFact,
  CssStyleRuleFact,
} from "../../types/css.js";

export type ExperimentalCssFileAnalysis = {
  filePath?: string;
  styleRules: CssStyleRuleFact[];
  classDefinitions: CssClassDefinitionFact[];
  classContexts: CssClassContextFact[];
  atRuleContexts: CssAtRuleContextFact[][];
};
