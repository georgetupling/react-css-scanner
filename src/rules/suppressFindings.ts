import type { Finding, RuleId } from "./types.js";

type FindingSuppressionRule = {
  suppressorRuleId: RuleId;
  suppressedRuleId: RuleId;
  suppresses: (finding: Finding, allFindings: Finding[]) => boolean;
};

const FINDING_SUPPRESSION_RULES: FindingSuppressionRule[] = [
  {
    suppressorRuleId: "missing-css-module-class",
    suppressedRuleId: "missing-css-class",
    suppresses(finding, allFindings) {
      if (finding.ruleId !== this.suppressedRuleId) {
        return false;
      }

      const sourceCssModuleMemberReferenceId = finding.data?.sourceCssModuleMemberReferenceId;
      if (typeof sourceCssModuleMemberReferenceId !== "string") {
        return false;
      }

      return allFindings.some(
        (candidate) =>
          candidate.ruleId === this.suppressorRuleId &&
          candidate.subject.kind === "css-module-member-reference" &&
          candidate.subject.id === sourceCssModuleMemberReferenceId,
      );
    },
  },
];

export function suppressFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => {
    return !FINDING_SUPPRESSION_RULES.some((rule) => rule.suppresses(finding, findings));
  });
}
