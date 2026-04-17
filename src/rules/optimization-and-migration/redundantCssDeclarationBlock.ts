import type { RuleDefinition } from "../types.js";
import { getAtRuleContextSignature, getDeclarationSignature, isCssModuleFile } from "../helpers.js";

export const redundantCssDeclarationBlockRule: RuleDefinition = {
  ruleId: "redundant-css-declaration-block",
  family: "optimization-and-migration",
  defaultSeverity: "info",
  run(context) {
    const severity = context.getRuleSeverity("redundant-css-declaration-block", "info");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      if (isCssModuleFile(context.model, cssFile.path)) {
        continue;
      }

      const comparableRules = cssFile.styleRules.filter((styleRule) => {
        if (styleRule.declarations.length === 0 || styleRule.selectorBranches.length !== 1) {
          return false;
        }

        const selectorBranch = styleRule.selectorBranches[0];
        return (
          selectorBranch.matchKind === "standalone" &&
          !selectorBranch.hasUnknownSemantics &&
          !selectorBranch.hasSubjectModifiers &&
          selectorBranch.subjectClassNames.length === 1
        );
      });

      const duplicateGroups = new Map<string, typeof comparableRules>();
      for (const styleRule of comparableRules) {
        const selectorBranch = styleRule.selectorBranches[0];
        const className = selectorBranch.subjectClassNames[0];
        const groupKey = [
          className,
          styleRule.selector,
          getAtRuleContextSignature(styleRule.atRuleContext),
          getDeclarationSignature(styleRule.declarations),
        ].join("::");
        const existingGroup = duplicateGroups.get(groupKey) ?? [];
        existingGroup.push(styleRule);
        duplicateGroups.set(groupKey, existingGroup);
      }

      for (const [groupKey, styleRules] of duplicateGroups.entries()) {
        if (styleRules.length < 2) {
          continue;
        }

        const [className, selector, atRuleContextSignature, declarationSignature] =
          groupKey.split("::");
        const sortedRules = [...styleRules].sort((left, right) => left.line - right.line);

        findings.push(
          context.createFinding({
            ruleId: "redundant-css-declaration-block",
            family: "optimization-and-migration",
            severity,
            confidence: "high",
            message: `Class "${className}" repeats the same CSS declarations in the same selector and at-rule context.`,
            primaryLocation: {
              filePath: cssFile.path,
              line: sortedRules[0].line,
            },
            relatedLocations: sortedRules.slice(1).map((styleRule) => ({
              filePath: cssFile.path,
              line: styleRule.line,
            })),
            subject: {
              className,
              cssFilePath: cssFile.path,
            },
            metadata: {
              selector,
              declarationSignature,
              atRuleContextSignature,
              duplicateLocations: sortedRules.map((styleRule) => ({
                filePath: cssFile.path,
                line: styleRule.line,
                selector: styleRule.selector,
                atRuleContext: styleRule.atRuleContext.map((entry) => ({
                  name: entry.name,
                  params: entry.params,
                })),
              })),
            },
          }),
        );
      }
    }

    return findings;
  },
};
