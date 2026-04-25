import type {
  CssAtRuleContextFact,
  CssClassDefinitionFact,
  CssStyleRuleFact,
} from "../../types/css.js";

export type ExperimentalCssFileAnalysis = {
  filePath?: string;
  styleRules: CssStyleRuleFact[];
  classDefinitions: CssClassDefinitionFact[];
  atRuleContexts: CssAtRuleContextFact[][];
};
