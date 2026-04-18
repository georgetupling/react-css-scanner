import {
  getAtRuleContextSignature,
  getDeclarationSignature,
  isSimpleRootClassDefinition,
} from "../../../../rules/cssDefinitionUtils.js";
import type { ExperimentalCssFileAnalysis } from "../../css-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";

export { getAtRuleContextSignature, getDeclarationSignature, isSimpleRootClassDefinition };

export function isExperimentalCssModuleFile(filePath: string | undefined): boolean {
  return filePath ? /\.module\.[^.]+$/i.test(filePath) : false;
}

export function toCssPrimaryLocation(input: {
  filePath?: string;
  line?: number;
}): ExperimentalRuleResult["primaryLocation"] {
  return {
    filePath: input.filePath,
    line: input.line,
  };
}

export function toAtRuleContextMetadata(cssFile: ExperimentalCssFileAnalysis, line: number) {
  const styleRule = cssFile.styleRules.find((candidate) => candidate.line === line);
  return (
    styleRule?.atRuleContext.map((entry) => ({
      name: entry.name,
      params: entry.params,
    })) ?? []
  );
}
