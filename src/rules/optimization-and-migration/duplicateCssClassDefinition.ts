import type { RuleDefinition } from "../types.js";
import {
  getAtRuleContextSignature,
  isCssModuleFile,
  isSimpleRootClassDefinition,
} from "../helpers.js";

export const duplicateCssClassDefinitionRule: RuleDefinition = {
  ruleId: "duplicate-css-class-definition",
  family: "optimization-and-migration",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("duplicate-css-class-definition", "warning");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const [className, definitions] of context.model.indexes.classDefinitionsByName.entries()) {
      const projectDefinitions = definitions.filter(
        (definition) =>
          !definition.externalSpecifier &&
          !isCssModuleFile(context.model, definition.cssFile) &&
          isSimpleRootClassDefinition(definition.definition),
      );

      if (projectDefinitions.length < 2) {
        continue;
      }

      const definitionsByAtRuleContext = new Map<string, typeof projectDefinitions>();
      for (const definition of projectDefinitions) {
        const atRuleContextSignature = getAtRuleContextSignature(
          definition.definition.atRuleContext,
        );
        const existingDefinitions = definitionsByAtRuleContext.get(atRuleContextSignature) ?? [];
        existingDefinitions.push(definition);
        definitionsByAtRuleContext.set(atRuleContextSignature, existingDefinitions);
      }

      for (const [atRuleContextSignature, comparableDefinitions] of definitionsByAtRuleContext) {
        if (comparableDefinitions.length < 2) {
          continue;
        }

        const sortedDefinitions = [...comparableDefinitions].sort((left, right) => {
          if (left.cssFile === right.cssFile) {
            return left.definition.line - right.definition.line;
          }

          return left.cssFile.localeCompare(right.cssFile);
        });

        const duplicateCssFiles = [
          ...new Set(sortedDefinitions.map((definition) => definition.cssFile)),
        ].sort((left, right) => left.localeCompare(right));

        findings.push(
          context.createFinding({
            ruleId: "duplicate-css-class-definition",
            family: "optimization-and-migration",
            severity,
            confidence: "high",
            message: `Class "${className}" is defined in multiple locations in project CSS, which may be confusing or redundant.`,
            primaryLocation: {
              filePath: sortedDefinitions[0].cssFile,
              line: sortedDefinitions[0].definition.line,
            },
            relatedLocations: sortedDefinitions.slice(1).map((definition) => ({
              filePath: definition.cssFile,
              line: definition.definition.line,
            })),
            subject: {
              className,
              cssFilePath: sortedDefinitions[0].cssFile,
            },
            metadata: {
              duplicateCssFiles,
              atRuleContextSignature,
              duplicateLocations: sortedDefinitions.map((definition) => ({
                filePath: definition.cssFile,
                line: definition.definition.line,
                selector: definition.definition.selector,
                atRuleContext: definition.definition.atRuleContext.map((entry) => ({
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
