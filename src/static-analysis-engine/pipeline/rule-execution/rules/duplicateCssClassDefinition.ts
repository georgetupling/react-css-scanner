import type { ExperimentalCssFileAnalysis } from "../../css-analysis/types.js";
import type { ExperimentalRuleResult } from "../types.js";
import {
  createCssRuleTraces,
  getAtRuleContextSignature,
  isExperimentalCssModuleFile,
  isSimpleRootClassDefinition,
  toCssPrimaryLocation,
} from "./cssRuleHelpers.js";

export function runDuplicateCssClassDefinitionRule(
  cssFiles: ExperimentalCssFileAnalysis[],
): ExperimentalRuleResult[] {
  const definitionsByClassName = new Map<
    string,
    Array<{
      cssFile: ExperimentalCssFileAnalysis;
      definition: ExperimentalCssFileAnalysis["classDefinitions"][number];
    }>
  >();

  for (const cssFile of cssFiles) {
    if (isExperimentalCssModuleFile(cssFile.filePath)) {
      continue;
    }

    for (const definition of cssFile.classDefinitions) {
      if (!isSimpleRootClassDefinition(definition)) {
        continue;
      }

      const existingDefinitions = definitionsByClassName.get(definition.className) ?? [];
      existingDefinitions.push({
        cssFile,
        definition,
      });
      definitionsByClassName.set(definition.className, existingDefinitions);
    }
  }

  const results: ExperimentalRuleResult[] = [];

  for (const [className, definitions] of definitionsByClassName.entries()) {
    if (definitions.length < 2) {
      continue;
    }

    const definitionsByAtRuleContext = new Map<string, typeof definitions>();
    for (const definition of definitions) {
      const atRuleContextSignature = getAtRuleContextSignature(definition.definition.atRuleContext);
      const existingDefinitions = definitionsByAtRuleContext.get(atRuleContextSignature) ?? [];
      existingDefinitions.push(definition);
      definitionsByAtRuleContext.set(atRuleContextSignature, existingDefinitions);
    }

    for (const [atRuleContextSignature, comparableDefinitions] of definitionsByAtRuleContext) {
      if (comparableDefinitions.length < 2) {
        continue;
      }

      const sortedDefinitions = [...comparableDefinitions].sort((left, right) => {
        const leftPath = left.cssFile.filePath ?? "";
        const rightPath = right.cssFile.filePath ?? "";
        if (leftPath === rightPath) {
          return left.definition.line - right.definition.line;
        }

        return leftPath.localeCompare(rightPath);
      });
      const duplicateCssFiles = [
        ...new Set(
          sortedDefinitions
            .map((definition) => definition.cssFile.filePath)
            .filter((filePath): filePath is string => Boolean(filePath)),
        ),
      ].sort((left, right) => left.localeCompare(right));

      results.push({
        ruleId: "duplicate-css-class-definition",
        severity: "warning",
        confidence: "high",
        summary: `Class "${className}" is defined in multiple locations in project CSS, which may be confusing or redundant.`,
        reasons: [
          "experimental Phase 7 pilot rule derived from parsed class definitions",
          "same root class name was defined multiple times in the same at-rule context",
        ],
        traces: createCssRuleTraces({
          ruleId: "duplicate-css-class-definition",
          summary: `Class "${className}" is defined in multiple locations in project CSS, which may be confusing or redundant.`,
          filePath: sortedDefinitions[0].cssFile.filePath,
          line: sortedDefinitions[0].definition.line,
          metadata: {
            className,
            duplicateCssFiles,
            atRuleContextSignature,
          },
        }),
        primaryLocation: toCssPrimaryLocation({
          filePath: sortedDefinitions[0].cssFile.filePath,
          line: sortedDefinitions[0].definition.line,
        }),
        selectorText: sortedDefinitions[0].definition.selector,
        metadata: {
          duplicateCssFiles,
          atRuleContextSignature,
          duplicateLocations: sortedDefinitions.map((definition) => ({
            filePath: definition.cssFile.filePath,
            line: definition.definition.line,
            selector: definition.definition.selector,
            atRuleContext: definition.definition.atRuleContext.map((entry) => ({
              name: entry.name,
              params: entry.params,
            })),
          })),
        },
      });
    }
  }

  return results;
}
