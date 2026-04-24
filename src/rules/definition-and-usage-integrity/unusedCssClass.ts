import type { RuleDefinition } from "../types.js";
import { getMigratedDefinitionAndUsageIntegrityRuleFindings } from "../../static-analysis-engine/adapters/current-scanner/runMigratedDefinitionAndUsageIntegrityRules.js";

export const unusedCssClassRule: RuleDefinition = {
  ruleId: "unused-css-class",
  family: "definition-and-usage-integrity",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("unused-css-class", "info");
    if (severity === "off") {
      return [];
    }

    return getMigratedDefinitionAndUsageIntegrityRuleFindings(context, "unused-css-class");
  },
};
