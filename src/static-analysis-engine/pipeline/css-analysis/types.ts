import type {
  CssAtRuleContextFact,
  CssClassDefinitionFact,
  CssStyleRuleFact,
} from "../../../facts/types.js";

export type ExperimentalCssFileAnalysis = {
  filePath?: string;
  styleRules: CssStyleRuleFact[];
  classDefinitions: CssClassDefinitionFact[];
  atRuleContexts: CssAtRuleContextFact[][];
};
