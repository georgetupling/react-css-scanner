import type { RuleDefinition } from "../types.js";
import { isCssModuleFile, isCssModuleReference } from "../helpers.js";
import { isPlainClassDefinition } from "../cssDefinitionUtils.js";
import { getDefinitionReachabilityStatus } from "../reachability.js";
import { getReferenceDefinitionCandidates } from "../referenceMatching.js";

export const unusedCssClassRule: RuleDefinition = {
  ruleId: "unused-css-class",
  family: "definition-and-usage-integrity",
  defaultSeverity: "info",
  run(context) {
    const severity = context.getRuleSeverity("unused-css-class", "info");
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
        const referencesWithStatus = references.flatMap((entry) => {
          if (isCssModuleReference(entry.reference.kind)) {
            return [];
          }

          return [
            {
              sourceFile: entry.sourceFile,
              reference: entry.reference,
              status: getDefinitionReachabilityStatus(
                context.model,
                entry.sourceFile,
                cssFile.path,
              ),
            },
          ];
        });
        const convincingReferences = referencesWithStatus.filter(
          (entry) =>
            entry.status === "direct" ||
            entry.status === "import-context" ||
            entry.status === "render-context-definite",
        );

        if (convincingReferences.length > 0) {
          continue;
        }

        const possibleRenderContextReferences = referencesWithStatus.filter(
          (entry) => entry.status === "render-context-possible",
        );
        if (possibleRenderContextReferences.length > 0) {
          continue;
        }
        let hasMatchedCandidateUsage = false;

        for (const sourceFile of context.model.graph.sourceFiles) {
          for (const reference of sourceFile.classReferences) {
            if (isCssModuleReference(reference.kind)) {
              continue;
            }

            const candidates = getReferenceDefinitionCandidates(
              context.model,
              sourceFile.path,
              reference,
            );
            if (
              candidates.some(
                (candidate) =>
                  candidate.cssFile === cssFile.path &&
                  candidate.className === definition.className &&
                  candidate.reachability !== "unreachable",
              )
            ) {
              hasMatchedCandidateUsage = true;
              break;
            }
          }

          if (hasMatchedCandidateUsage) {
            break;
          }
        }

        if (hasMatchedCandidateUsage) {
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
