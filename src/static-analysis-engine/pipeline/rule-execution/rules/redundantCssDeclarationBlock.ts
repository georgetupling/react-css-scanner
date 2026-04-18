import type { ExperimentalCssFileAnalysis } from "../../css-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";
import {
  getAtRuleContextSignature,
  getDeclarationSignature,
  isExperimentalCssModuleFile,
  toCssPrimaryLocation,
} from "./cssRuleHelpers.js";

export function runRedundantCssDeclarationBlockRule(
  cssFile: ExperimentalCssFileAnalysis,
): ExperimentalRuleResult[] {
  if (isExperimentalCssModuleFile(cssFile.filePath)) {
    return [];
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

  const results: ExperimentalRuleResult[] = [];

  for (const [groupKey, styleRules] of duplicateGroups.entries()) {
    if (styleRules.length < 2) {
      continue;
    }

    const [className, selector, atRuleContextSignature, declarationSignature] =
      groupKey.split("::");
    const sortedRules = [...styleRules].sort((left, right) => left.line - right.line);

    results.push({
      ruleId: "redundant-css-declaration-block",
      severity: "info",
      confidence: "high",
      summary: `Class "${className}" repeats the same CSS declarations in the same selector and at-rule context.`,
      reasons: [
        "experimental Phase 7 pilot rule derived from parsed CSS declaration signatures",
        "duplicate declaration block group was found inside the same stylesheet",
      ],
      primaryLocation: toCssPrimaryLocation({
        filePath: cssFile.filePath,
        line: sortedRules[0].line,
      }),
      selectorText: selector,
      cssFile,
      metadata: {
        selector,
        declarationSignature,
        atRuleContextSignature,
        duplicateLocations: sortedRules.map((styleRule) => ({
          filePath: cssFile.filePath,
          line: styleRule.line,
          selector: styleRule.selector,
          atRuleContext: styleRule.atRuleContext.map((entry) => ({
            name: entry.name,
            params: entry.params,
          })),
        })),
      },
    });
  }

  return results;
}
