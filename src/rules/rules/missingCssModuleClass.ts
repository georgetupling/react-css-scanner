import type { AnalysisTrace } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const missingCssModuleClassRule: RuleDefinition = {
  id: "missing-css-module-class",
  run(context) {
    return runMissingCssModuleClassRule(context);
  },
};

function runMissingCssModuleClassRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const match of context.analysis.relations.cssModuleMemberMatches) {
    if (match.status !== "missing") {
      continue;
    }

    const reference = context.analysis.indexes.cssModuleMemberReferencesById.get(match.referenceId);
    const cssModuleImport = context.analysis.indexes.cssModuleImportsById.get(match.importId);
    if (!reference || !cssModuleImport) {
      continue;
    }

    findings.push({
      id: `missing-css-module-class:${reference.id}:${reference.memberName}`,
      ruleId: "missing-css-module-class",
      confidence: "high",
      message: `CSS Module member "${reference.memberName}" is referenced but not exported by ${cssModuleImport.stylesheetFilePath}.`,
      subject: {
        kind: "css-module-member-reference",
        id: reference.id,
      },
      location: reference.location,
      evidence: [
        {
          kind: "css-module-import",
          id: cssModuleImport.id,
        },
        {
          kind: "stylesheet",
          id: cssModuleImport.stylesheetId,
        },
      ],
      traces: buildMissingCssModuleClassTraces({
        reference,
        cssModuleImport,
        match,
      }),
      data: {
        memberName: reference.memberName,
        rawExpressionText: reference.rawExpressionText,
        stylesheetId: cssModuleImport.stylesheetId,
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
      },
    });
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildMissingCssModuleClassTraces(input: {
  reference: RuleContext["analysis"]["entities"]["cssModuleMemberReferences"][number];
  cssModuleImport: RuleContext["analysis"]["entities"]["cssModuleImports"][number];
  match: RuleContext["analysis"]["relations"]["cssModuleMemberMatches"][number];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:missing-css-module-class:${input.reference.id}`,
      category: "rule-evaluation",
      summary: `CSS Module member "${input.reference.memberName}" was looked up in ${input.cssModuleImport.stylesheetFilePath}, but no exported class was found`,
      anchor: input.reference.location,
      children: [
        ...input.reference.traces,
        ...input.match.traces,
        {
          traceId: `rule-evaluation:missing-css-module-class:${input.reference.id}:module-export-lookup`,
          category: "rule-evaluation",
          summary: `no CSS Module export named "${input.reference.memberName}" was found`,
          anchor: input.reference.location,
          children: [],
          metadata: {
            memberName: input.reference.memberName,
            stylesheetId: input.cssModuleImport.stylesheetId,
            stylesheetFilePath: input.cssModuleImport.stylesheetFilePath,
          },
        },
      ],
      metadata: {
        ruleId: "missing-css-module-class",
        referenceId: input.reference.id,
        importId: input.cssModuleImport.id,
        memberName: input.reference.memberName,
      },
    },
  ];
}
