import {
  getAtRuleContextSignature,
  getDeclarationSignature,
  isSimpleRootClassDefinition,
} from "./cssDefinitionUtils.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
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

export function createCssRuleTraces(input: {
  ruleId: string;
  summary: string;
  filePath?: string;
  line?: number;
  metadata?: Record<string, unknown>;
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:${input.ruleId}:${input.filePath ?? "unknown"}:${input.line ?? "unknown"}`,
      category: "rule-evaluation",
      summary: input.summary,
      ...(input.filePath
        ? {
            anchor: {
              filePath: input.filePath,
              ...(input.line
                ? { startLine: input.line, startColumn: 1, endLine: input.line }
                : { startLine: 1, startColumn: 1 }),
            },
          }
        : {}),
      children: [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  ];
}
