import type { RuleDefinition } from "../types.js";
import {
  getDefinitionReachabilityStatus,
  getProjectClassDefinitions,
  isCssModuleReference,
} from "../helpers.js";

export const cssClassMissingInSomeContextsRule: RuleDefinition = {
  ruleId: "css-class-missing-in-some-contexts",
  family: "definition-and-usage-integrity",
  defaultSeverity: "info",
  run(context) {
    const severity = context.getRuleSeverity("css-class-missing-in-some-contexts", "info");
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
        const strongerDefinitions = definitionsWithStatus.filter(
          (entry) =>
            entry.status === "direct" ||
            entry.status === "import-context" ||
            entry.status === "render-context-definite",
        );
        if (strongerDefinitions.length > 0) {
          continue;
        }

        const possibleDefinitions = definitionsWithStatus.filter(
          (entry) => entry.status === "render-context-possible",
        );
        if (possibleDefinitions.length === 0) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "css-class-missing-in-some-contexts",
            family: "definition-and-usage-integrity",
            severity,
            confidence: "low",
            message: `Class "${reference.className}" is only backed by CSS in some known render contexts for "${sourceFile.path}".`,
            primaryLocation: {
              filePath: sourceFile.path,
              line: reference.line,
              column: reference.column,
            },
            relatedLocations: possibleDefinitions.map((entry) => ({
              filePath: entry.definition.cssFile,
              line: entry.definition.definition.line,
            })),
            subject: {
              className: reference.className,
              sourceFilePath: sourceFile.path,
            },
            metadata: {
              referenceKind: reference.kind,
              renderContextReachability: "possible",
              possibleRenderContextCssFiles: possibleDefinitions.map(
                (entry) => entry.definition.cssFile,
              ),
            },
          }),
        );
      }
    }

    return findings;
  },
};
