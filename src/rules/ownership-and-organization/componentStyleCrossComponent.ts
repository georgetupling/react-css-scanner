import type { RuleDefinition } from "../types.js";
import { getOwningSourceFiles, getUsingSourceFiles } from "../helpers.js";

export const componentStyleCrossComponentRule: RuleDefinition = {
  ruleId: "component-style-cross-component",
  family: "ownership-and-organization",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("component-style-cross-component", "warning");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      if (cssFile.ownership !== "component") {
        continue;
      }

      const ownerSources = getOwningSourceFiles(context.model, cssFile.path);
      if (ownerSources.size === 0) {
        continue;
      }

      const usingSources = getUsingSourceFiles(context.model, cssFile);
      const crossComponentSources = [...usingSources].filter(
        (sourceFile) => !ownerSources.has(sourceFile),
      );

      if (crossComponentSources.length === 0) {
        continue;
      }

      findings.push(
        context.createFinding({
          ruleId: "component-style-cross-component",
          family: "ownership-and-organization",
          severity,
          confidence: "high",
          message: `Component-local CSS "${cssFile.path}" is used outside its owning component scope.`,
          primaryLocation: {
            filePath: cssFile.path,
          },
          relatedLocations: crossComponentSources.map((sourceFile) => ({
            filePath: sourceFile,
          })),
          subject: {
            cssFilePath: cssFile.path,
          },
          metadata: {
            ownerSources: [...ownerSources].sort((left, right) => left.localeCompare(right)),
            crossComponentSources: crossComponentSources.sort((left, right) =>
              left.localeCompare(right),
            ),
          },
        }),
      );
    }

    return findings;
  },
};
