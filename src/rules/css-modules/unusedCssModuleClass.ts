import type { RuleDefinition } from "../types.js";
import { isCssModuleFile } from "../helpers.js";

export const unusedCssModuleClassRule: RuleDefinition = {
  ruleId: "unused-css-module-class",
  family: "css-modules",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("unused-css-module-class", "warning");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      if (!isCssModuleFile(context.model, cssFile.path)) {
        continue;
      }

      const importingSources = context.model.graph.sourceFiles.filter((sourceFile) =>
        sourceFile.cssModuleImports.some((entry) => entry.resolvedPath === cssFile.path),
      );

      for (const definition of cssFile.classDefinitions) {
        const isUsed = importingSources.some((sourceFile) =>
          sourceFile.classReferences.some((reference) => {
            if (
              !reference.className ||
              reference.className !== definition.className ||
              (reference.kind !== "css-module-property" &&
                reference.kind !== "css-module-dynamic-property")
            ) {
              return false;
            }

            const moduleLocalName = reference.metadata?.moduleLocalName;
            if (typeof moduleLocalName !== "string") {
              return false;
            }

            return sourceFile.cssModuleImports.some(
              (entry) => entry.localName === moduleLocalName && entry.resolvedPath === cssFile.path,
            );
          }),
        );

        if (isUsed) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "unused-css-module-class",
            family: "css-modules",
            severity,
            confidence: "high",
            message: `CSS Module class "${definition.className}" in "${cssFile.path}" does not appear to be used by its importing source files.`,
            primaryLocation: {
              filePath: cssFile.path,
              line: definition.line,
            },
            relatedLocations: importingSources.map((sourceFile) => ({
              filePath: sourceFile.path,
            })),
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
