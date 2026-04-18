import type { RuleDefinition } from "../types.js";
import {
  getDeclaredExternalProviderForClass,
  getProjectClassDefinitions,
  isCssModuleReference,
} from "../helpers.js";

export const missingCssClassRule: RuleDefinition = {
  ruleId: "missing-css-class",
  family: "definition-and-usage-integrity",
  defaultSeverity: "warning",
  run(context) {
    const severity = context.getRuleSeverity("missing-css-class", "info");
    if (severity === "off") {
      return [];
    }

    const findings = [];

    for (const sourceFile of context.model.graph.sourceFiles) {
      const reachability = context.model.reachability.get(sourceFile.path);
      if (!reachability) {
        continue;
      }

      for (const reference of sourceFile.classReferences) {
        if (!reference.className || isCssModuleReference(reference.kind)) {
          continue;
        }

        const candidateDefinitions = getProjectClassDefinitions(context.model, reference.className);
        if (candidateDefinitions.length > 0) {
          continue;
        }

        const declaredExternalProvider = getDeclaredExternalProviderForClass(
          context.model,
          reference.className,
        );
        if (declaredExternalProvider) {
          continue;
        }

        const hasReachableRemoteExternalCss = [...reachability.externalCss].some(
          (specifier) => specifier.startsWith("http://") || specifier.startsWith("https://"),
        );
        if (hasReachableRemoteExternalCss) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "missing-css-class",
            family: "definition-and-usage-integrity",
            severity,
            confidence: reference.confidence,
            message: `Class "${reference.className}" is referenced in React code but no matching reachable CSS class definition was found.`,
            primaryLocation: {
              filePath: sourceFile.path,
              line: reference.line,
              column: reference.column,
            },
            subject: {
              className: reference.className,
              sourceFilePath: sourceFile.path,
            },
            metadata: {
              referenceKind: reference.kind,
            },
          }),
        );
      }
    }

    return findings;
  },
};
