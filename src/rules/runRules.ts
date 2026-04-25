import { DEFAULT_RULE_SEVERITIES, RULE_DEFINITIONS } from "./catalogue.js";
import type { RuleContext, RuleEngineResult } from "./types.js";
import type { ScannerConfig } from "../config/index.js";

export function runRules(context: RuleContext & { config: ScannerConfig }): RuleEngineResult {
  return {
    findings: RULE_DEFINITIONS.flatMap((rule) => {
      const configuredSeverity = context.config.rules[rule.id];
      if (configuredSeverity === "off") {
        return [];
      }

      const severity = configuredSeverity ?? DEFAULT_RULE_SEVERITIES[rule.id];
      return rule.run(context).map((finding) => ({
        ...finding,
        severity,
      }));
    }).sort((left, right) => left.id.localeCompare(right.id)),
  };
}
