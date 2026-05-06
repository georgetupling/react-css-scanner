import {
  stylesheetNodeId,
  ruleDefinitionNodeId,
  selectorBranchNodeId,
  selectorNodeId,
} from "../ids.js";
import { frontendFileProvenance } from "../provenance.js";
import type {
  FactGraphInput,
  RuleDefinitionNode,
  SelectorBranchNode,
  SelectorNode,
} from "../types.js";
import { sortNodes } from "../utils/sortGraphElements.js";

export type BuiltCssNodes = {
  all: Array<RuleDefinitionNode | SelectorNode | SelectorBranchNode>;
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
};

export function buildCssNodes(input: FactGraphInput): BuiltCssNodes {
  const ruleDefinitions: RuleDefinitionNode[] = [];
  const selectors: SelectorNode[] = [];
  const selectorBranches: SelectorBranchNode[] = [];

  for (const cssFile of [...input.frontends.css.files].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    const currentStylesheetId = stylesheetNodeId(cssFile.filePath);

    cssFile.rules.forEach((rule, ruleIndex) => {
      const ruleId = ruleDefinitionNodeId(currentStylesheetId, ruleIndex);
      const selectorId = selectorNodeId(currentStylesheetId, ruleIndex);
      const declarationProperties = [
        ...new Set(rule.declarations.map((declaration) => declaration.property)),
      ].sort((left, right) => left.localeCompare(right));
      const selectorEntries = cssFile.selectorEntries.filter(
        (entry) =>
          entry.source.kind === "css-source" &&
          entry.source.ruleKey === rule.selectorEntries[0]?.ruleKey,
      );

      ruleDefinitions.push({
        id: ruleId,
        kind: "rule-definition",
        stylesheetNodeId: currentStylesheetId,
        filePath: cssFile.filePath,
        selectorText: rule.selector,
        declarationProperties,
        declarationSignature: rule.declarations
          .map((declaration) => `${declaration.property}:${declaration.value}`)
          .join(";"),
        line: rule.line,
        atRuleContext: [...rule.atRuleContext],
        location: rule.selectorEntries[0]?.selectorAnchor,
        sourceRule: rule,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: cssFile.filePath,
          summary: "Extracted CSS rule frontend fact",
        }),
      });
      selectors.push({
        id: selectorId,
        kind: "selector",
        stylesheetNodeId: currentStylesheetId,
        ruleDefinitionNodeId: ruleId,
        selectorText: rule.selector,
        selectorListText: rule.selector,
        sourceKind: "css-rule",
        location: rule.selectorEntries[0]?.selectorAnchor,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: cssFile.filePath,
          summary: "Extracted CSS selector frontend fact",
        }),
      });

      for (const entry of selectorEntries) {
        if (entry.source.kind !== "css-source" || entry.source.branchIndex === undefined) {
          continue;
        }

        const branchFact = rule.selectorBranches[entry.source.branchIndex];
        if (!branchFact) {
          continue;
        }

        selectorBranches.push({
          id: selectorBranchNodeId(currentStylesheetId, ruleIndex, entry.source.branchIndex),
          kind: "selector-branch",
          selectorNodeId: selectorId,
          stylesheetNodeId: currentStylesheetId,
          ruleDefinitionNodeId: ruleId,
          selectorText: entry.selectorText,
          selectorListText: entry.source.selectorListText ?? rule.selector,
          branchIndex: entry.source.branchIndex,
          branchCount: entry.source.branchCount ?? rule.selectorBranches.length,
          ruleKey: entry.source.ruleKey ?? `${cssFile.filePath}:${ruleIndex}:${rule.selector}`,
          requiredClassNames: [...branchFact.requiredClassNames],
          subjectClassNames: [...branchFact.subjectClassNames],
          contextClassNames: [...branchFact.contextClassNames],
          negativeClassNames: [...branchFact.negativeClassNames],
          hasDescendantClassNames: [...branchFact.hasDescendantClassNames],
          matchKind: branchFact.matchKind,
          hasUnknownSemantics: branchFact.hasUnknownSemantics,
          atRuleContext: entry.source.atRuleContext ?? [],
          location: entry.source.selectorAnchor,
          sourceQuery: entry,
          confidence: branchFact.hasUnknownSemantics ? "medium" : "high",
          provenance: frontendFileProvenance({
            filePath: cssFile.filePath,
            summary: "Extracted CSS selector branch frontend fact",
          }),
        });
      }
    });
  }

  return {
    all: sortNodes([...ruleDefinitions, ...selectors, ...selectorBranches]),
    ruleDefinitions: sortNodes(ruleDefinitions),
    selectors: sortNodes(selectors),
    selectorBranches: sortNodes(selectorBranches),
  };
}
