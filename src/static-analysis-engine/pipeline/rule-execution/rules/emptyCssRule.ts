import type { ExperimentalCssFileAnalysis } from "../../css-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";
import {
  createCssRuleTraces,
  toAtRuleContextMetadata,
  toCssPrimaryLocation,
} from "./cssRuleHelpers.js";

export function runEmptyCssRule(cssFile: ExperimentalCssFileAnalysis): ExperimentalRuleResult[] {
  return cssFile.styleRules.flatMap((styleRule) => {
    if (styleRule.declarations.length > 0) {
      return [];
    }

    return [
      {
        ruleId: "empty-css-rule",
        severity: "warning",
        confidence: "high",
        summary: `Selector "${styleRule.selector}" in "${cssFile.filePath}" does not contain any CSS declarations.`,
        reasons: [
          "experimental Phase 7 pilot rule derived from parsed CSS style rules",
          "selector block was parsed successfully but declaration list was empty",
        ],
        traces: createCssRuleTraces({
          ruleId: "empty-css-rule",
          summary: `Selector "${styleRule.selector}" in "${cssFile.filePath}" does not contain any CSS declarations.`,
          filePath: cssFile.filePath,
          line: styleRule.line,
          metadata: {
            selector: styleRule.selector,
          },
        }),
        primaryLocation: toCssPrimaryLocation({
          filePath: cssFile.filePath,
          line: styleRule.line,
        }),
        selectorText: styleRule.selector,
        cssFile,
        metadata: {
          selector: styleRule.selector,
          atRuleContext: toAtRuleContextMetadata(cssFile, styleRule.line),
        },
      },
    ];
  });
}
