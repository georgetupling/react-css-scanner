import type { RuleDefinition } from "../types.js";
import { getProjectClassDefinitions, isCssModuleReference } from "../helpers.js";
import { getDefinitionReachabilityStatus } from "../reachability.js";

export const unreachableCssRule: RuleDefinition = {
  ruleId: "unreachable-css",
  family: "definition-and-usage-integrity",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("unreachable-css", "info");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const sourceFile of context.model.graph.sourceFiles) {
      for (const reference of sourceFile.classReferences) {
        if (!reference.className || isCssModuleReference(reference.kind)) {
          continue;
        }

        const candidateDefinitions = getProjectClassDefinitions(context.model, reference.className);
        if (candidateDefinitions.length === 0) {
          continue;
        }

        const definitionsWithStatus = candidateDefinitions.map((definition) => ({
          definition,
          status: getDefinitionReachabilityStatus(
            context.model,
            sourceFile.path,
            definition.cssFile,
            definition.externalSpecifier,
          ),
        }));
        const definitelyReachableDefinitions = definitionsWithStatus.filter(
          (entry) => entry.status === "direct" || entry.status === "import-context",
        );
        if (definitelyReachableDefinitions.length > 0) {
          continue;
        }

        const definiteRenderContextDefinitions = definitionsWithStatus.filter(
          (entry) => entry.status === "render-context-definite",
        );
        if (definiteRenderContextDefinitions.length > 0) {
          continue;
        }

        const possibleRenderContextDefinitions = definitionsWithStatus.filter(
          (entry) => entry.status === "render-context-possible",
        );
        if (possibleRenderContextDefinitions.length > 0) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "unreachable-css",
            family: "definition-and-usage-integrity",
            severity,
            confidence: reference.confidence,
            message: `Class "${reference.className}" exists in project CSS, but not in CSS reachable from "${sourceFile.path}".`,
            primaryLocation: {
              filePath: sourceFile.path,
              line: reference.line,
              column: reference.column,
            },
            relatedLocations: candidateDefinitions.map((definition) => ({
              filePath: definition.cssFile,
              line: definition.definition.line,
            })),
            subject: {
              className: reference.className,
              sourceFilePath: sourceFile.path,
            },
            metadata: {
              candidateCssFiles: candidateDefinitions.map((definition) => definition.cssFile),
            },
          }),
        );
      }
    }

    return findings;
  },
};
