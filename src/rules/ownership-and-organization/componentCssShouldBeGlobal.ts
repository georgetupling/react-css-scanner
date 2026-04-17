import type { RuleDefinition } from "../types.js";
import { getOwningSourceFiles, getRuleNumberConfig, getUsingSourceFiles } from "../helpers.js";

export const componentCssShouldBeGlobalRule: RuleDefinition = {
  ruleId: "component-css-should-be-global",
  family: "ownership-and-organization",
  defaultSeverity: "info",
  run(context) {
    const severity = context.getRuleSeverity("component-css-should-be-global", "info");
    if (severity === "off") {
      return [];
    }

    const threshold = getRuleNumberConfig(
      context.model,
      "component-css-should-be-global",
      "threshold",
      8,
    );
    const findings = [];

    for (const cssFile of context.model.graph.cssFiles) {
      if (cssFile.ownership !== "component") {
        continue;
      }

      const ownerSources = getOwningSourceFiles(context.model, cssFile.path);
      const usingSources = [...getUsingSourceFiles(context.model, cssFile)].sort((left, right) =>
        left.localeCompare(right),
      );
      const nonOwnerUsageCount = usingSources.filter(
        (sourceFile) => !ownerSources.has(sourceFile),
      ).length;

      if (nonOwnerUsageCount < threshold) {
        continue;
      }

      findings.push(
        context.createFinding({
          ruleId: "component-css-should-be-global",
          family: "ownership-and-organization",
          severity,
          confidence: "medium",
          message: `Component CSS "${cssFile.path}" is used broadly enough that it may really belong in the global tier.`,
          primaryLocation: {
            filePath: cssFile.path,
          },
          relatedLocations: usingSources.map((sourceFile) => ({ filePath: sourceFile })),
          subject: {
            cssFilePath: cssFile.path,
          },
          metadata: {
            threshold,
            ownerSources: [...ownerSources].sort((left, right) => left.localeCompare(right)),
            usingSources,
          },
        }),
      );
    }

    return findings;
  },
};
