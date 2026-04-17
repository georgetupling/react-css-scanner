import type { RuleSeverity } from "../config/types.js";
import { RULE_DEFINITIONS } from "./catalog.js";
import { createFinding, sortFindings } from "../runtime/findings.js";
import type { ProjectModel } from "../model/types.js";
import type { Finding } from "../runtime/types.js";
import type { RuleDefinition, RuleEngineResult } from "./types.js";

export function runRules(
  model: ProjectModel,
  rules: RuleDefinition[] = RULE_DEFINITIONS,
): RuleEngineResult {
  const findings: Finding[] = [];

  for (const rule of rules) {
    const producedFindings = rule.run({
      model,
      createFinding,
      getRuleSeverity,
    });
    findings.push(...producedFindings);
  }

  return {
    findings: sortFindings(findings),
  };

  function getRuleSeverity(ruleId: string, defaultSeverity: RuleSeverity): RuleSeverity {
    const configuredValue = model.config.rules[ruleId];
    if (typeof configuredValue === "string") {
      return configuredValue;
    }

    if (configuredValue && typeof configuredValue === "object") {
      return configuredValue.severity;
    }

    return defaultSeverity;
  }
}
