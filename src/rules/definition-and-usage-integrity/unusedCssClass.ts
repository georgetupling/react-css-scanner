import type { RuleDefinition } from "../types.js";
import {
  isCssModuleFile,
  isCssModuleReference,
  isDefinitionReachable,
  isPlainClassDefinition,
} from "../helpers.js";

export const unusedCssClassRule: RuleDefinition = {
  ruleId: "unused-css-class",
  family: "definition-and-usage-integrity",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("unused-css-class", "warning");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      if (isCssModuleFile(context.model, cssFile.path)) {
        continue;
      }

      for (const definition of cssFile.classDefinitions) {
        if (!isPlainClassDefinition(definition)) {
          continue;
        }

        const references =
          context.model.indexes.classReferencesByName.get(definition.className) ?? [];
        const convincingReferences = references.filter((entry) => {
          if (isCssModuleReference(entry.reference.kind)) {
            return false;
          }

          return isDefinitionReachable(context.model, entry.sourceFile, cssFile.path);
        });

        if (convincingReferences.length > 0) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "unused-css-class",
            family: "definition-and-usage-integrity",
            severity,
            confidence: "high",
            message: `CSS class "${definition.className}" does not have any convincing reachable React usage.`,
            primaryLocation: {
              filePath: cssFile.path,
              line: definition.line,
            },
            subject: {
              className: definition.className,
              cssFilePath: cssFile.path,
            },
          }),
        );
      }
    }

    return findings;
  },
};
