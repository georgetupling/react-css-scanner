import type { RuleDefinition } from "../types.js";

export const emptyCssRuleRule: RuleDefinition = {
  ruleId: "empty-css-rule",
  family: "optimization-and-migration",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("empty-css-rule", "info");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      for (const styleRule of cssFile.styleRules) {
        if (styleRule.declarations.length > 0) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "empty-css-rule",
            family: "optimization-and-migration",
            severity,
            confidence: "high",
            message: `Selector "${styleRule.selector}" in "${cssFile.path}" does not contain any CSS declarations.`,
            primaryLocation: {
              filePath: cssFile.path,
              line: styleRule.line,
            },
            subject: {
              cssFilePath: cssFile.path,
            },
            metadata: {
              selector: styleRule.selector,
              atRuleContext: styleRule.atRuleContext.map((entry) => ({
                name: entry.name,
                params: entry.params,
              })),
            },
          }),
        );
      }
    }

    return findings;
  },
};
