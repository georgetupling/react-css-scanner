import { DEFAULT_RULE_SEVERITIES, RULE_DEFINITIONS } from "./catalogue.js";
import type { RuleContext, RuleEngineResult, RuleSeverity } from "./types.js";

export function runRules(context: RuleContext): RuleEngineResult {
  const profileEnabled = process.env.SCAN_REACT_CSS_PROFILE_RUN_RULES === "1";
  return {
    findings: RULE_DEFINITIONS.flatMap((rule) => {
      const severity = context.config.rules[rule.id] ?? DEFAULT_RULE_SEVERITIES[rule.id];
      if (severity === "off") {
        return [];
      }

      const startedAt = performance.now();
      const rawFindings = rule.run(context);
      if (profileEnabled) {
        const elapsedMs = performance.now() - startedAt;
        console.error(
          `[profile:run-rules] ${rule.id}: ${elapsedMs.toFixed(1)}ms findings=${rawFindings.length}`,
        );
      }
      return rawFindings.map((finding) => ({
        ...finding,
        severity: severity satisfies RuleSeverity,
        traces: context.includeTraces === false ? [] : finding.traces,
      }));
    }).sort((left, right) => left.id.localeCompare(right.id)),
  };
}
