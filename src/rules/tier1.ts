import type { RuleDefinition } from "./types.js";
import {
  DYNAMIC_REFERENCE_KINDS,
  getDeclarationOverlap,
  getOwningSourceFiles,
  getProjectClassDefinitions,
  getRuleNumberConfig,
  getUsingSourceFiles,
  isCssModuleFile,
  isCssModuleReference,
  isDefinitionReachable,
} from "./helpers.js";

export const TIER_1_RULE_DEFINITIONS: RuleDefinition[] = [
  {
    ruleId: "missing-css-class",
    family: "definition-and-usage-integrity",
    defaultSeverity: "error",
    run(context) {
      const severity = context.getRuleSeverity("missing-css-class", "error");
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

          const candidateDefinitions = getProjectClassDefinitions(
            context.model,
            reference.className,
          );
          const reachableDefinitions = candidateDefinitions.filter((definition) =>
            isDefinitionReachable(
              context.model,
              sourceFile.path,
              definition.cssFile,
              definition.externalSpecifier,
            ),
          );

          if (reachableDefinitions.length > 0) {
            continue;
          }

          if (candidateDefinitions.length > 0) {
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
  },
  {
    ruleId: "unreachable-css",
    family: "definition-and-usage-integrity",
    defaultSeverity: "error",
    run(context) {
      const severity = context.getRuleSeverity("unreachable-css", "error");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const sourceFile of context.model.graph.sourceFiles) {
        for (const reference of sourceFile.classReferences) {
          if (!reference.className || isCssModuleReference(reference.kind)) {
            continue;
          }

          const candidateDefinitions = getProjectClassDefinitions(
            context.model,
            reference.className,
          );
          if (candidateDefinitions.length === 0) {
            continue;
          }

          const reachableDefinitions = candidateDefinitions.filter((definition) =>
            isDefinitionReachable(
              context.model,
              sourceFile.path,
              definition.cssFile,
              definition.externalSpecifier,
            ),
          );
          if (reachableDefinitions.length > 0) {
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
              },
              relatedLocations: candidateDefinitions.map((definition) => ({
                filePath: definition.cssFile,
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
  },
  {
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
  },
  {
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
  },
  {
    ruleId: "global-css-not-global",
    family: "ownership-and-organization",
    defaultSeverity: "info",
    run(context) {
      const severity = context.getRuleSeverity("global-css-not-global", "info");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const cssFile of context.model.graph.cssFiles) {
        if (cssFile.ownership !== "global") {
          continue;
        }

        const usingSources = [...getUsingSourceFiles(context.model, cssFile)].sort((left, right) =>
          left.localeCompare(right),
        );

        if (usingSources.length > 1) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "global-css-not-global",
            family: "ownership-and-organization",
            severity,
            confidence: "high",
            message: `Global CSS "${cssFile.path}" is only used in a narrow scope and may not belong in the global tier.`,
            primaryLocation: {
              filePath: cssFile.path,
            },
            relatedLocations: usingSources.map((sourceFile) => ({
              filePath: sourceFile,
            })),
            subject: {
              cssFilePath: cssFile.path,
            },
            metadata: {
              usingSources,
            },
          }),
        );
      }

      return findings;
    },
  },
  {
    ruleId: "utility-class-replacement",
    family: "optimization-and-migration",
    defaultSeverity: "info",
    run(context) {
      const severity = context.getRuleSeverity("utility-class-replacement", "info");
      if (severity === "off") {
        return [];
      }

      const threshold = getRuleNumberConfig(
        context.model,
        "utility-class-replacement",
        "minDeclarationOverlap",
        2,
      );

      const utilityDefinitions = context.model.graph.cssFiles
        .filter((cssFile) => cssFile.ownership === "utility")
        .flatMap((cssFile) =>
          cssFile.classDefinitions.map((definition) => ({
            cssFile: cssFile.path,
            definition,
          })),
        );

      if (utilityDefinitions.length === 0) {
        return [];
      }

      const findings = [];

      for (const cssFile of context.model.graph.cssFiles) {
        if (cssFile.ownership === "utility" || isCssModuleFile(context.model, cssFile.path)) {
          continue;
        }

        for (const definition of cssFile.classDefinitions) {
          let bestMatch: { cssFile: string; className: string; overlap: number } | undefined;

          for (const utilityDefinition of utilityDefinitions) {
            if (utilityDefinition.definition.className === definition.className) {
              continue;
            }

            const overlap = getDeclarationOverlap(
              definition.declarations,
              utilityDefinition.definition.declarations,
            );
            if (overlap < threshold) {
              continue;
            }

            if (!bestMatch || overlap > bestMatch.overlap) {
              bestMatch = {
                cssFile: utilityDefinition.cssFile,
                className: utilityDefinition.definition.className,
                overlap,
              };
            }
          }

          if (!bestMatch) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "utility-class-replacement",
              family: "optimization-and-migration",
              severity,
              confidence: "medium",
              message: `Class "${definition.className}" overlaps with utility class "${bestMatch.className}" and may be replaceable.`,
              primaryLocation: {
                filePath: cssFile.path,
              },
              relatedLocations: [
                {
                  filePath: bestMatch.cssFile,
                },
              ],
              subject: {
                className: definition.className,
                cssFilePath: cssFile.path,
              },
              metadata: {
                utilityClassName: bestMatch.className,
                utilityCssFile: bestMatch.cssFile,
                declarationOverlap: bestMatch.overlap,
              },
            }),
          );
        }
      }

      return findings;
    },
  },
  {
    ruleId: "dynamic-class-reference",
    family: "dynamic-analysis",
    defaultSeverity: "warning",
    run(context) {
      const severity = context.getRuleSeverity("dynamic-class-reference", "warning");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const sourceFile of context.model.graph.sourceFiles) {
        for (const reference of sourceFile.classReferences) {
          if (reference.confidence === "high" && !DYNAMIC_REFERENCE_KINDS.has(reference.kind)) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "dynamic-class-reference",
              family: "dynamic-analysis",
              severity,
              confidence: reference.confidence,
              message: `Dynamic class composition in "${sourceFile.path}" could not be resolved with full confidence.`,
              primaryLocation: {
                filePath: sourceFile.path,
              },
              subject: {
                className: reference.className,
                sourceFilePath: sourceFile.path,
              },
              metadata: {
                referenceKind: reference.kind,
                sourceExpression: reference.source,
              },
            }),
          );
        }
      }

      return findings;
    },
  },
  {
    ruleId: "missing-css-module-class",
    family: "css-modules",
    defaultSeverity: "error",
    run(context) {
      const severity = context.getRuleSeverity("missing-css-module-class", "error");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const sourceFile of context.model.graph.sourceFiles) {
        for (const reference of sourceFile.classReferences) {
          if (
            !reference.className ||
            (reference.kind !== "css-module-property" &&
              reference.kind !== "css-module-dynamic-property")
          ) {
            continue;
          }

          const moduleLocalName = reference.metadata?.moduleLocalName;
          if (typeof moduleLocalName !== "string") {
            continue;
          }

          const cssModuleImport = sourceFile.cssModuleImports.find(
            (entry) => entry.localName === moduleLocalName,
          );
          if (!cssModuleImport?.resolvedPath) {
            continue;
          }

          const cssFile = context.model.indexes.cssFileByPath.get(cssModuleImport.resolvedPath);
          if (!cssFile) {
            continue;
          }

          const classExists = cssFile.classDefinitions.some(
            (definition) => definition.className === reference.className,
          );
          if (classExists) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "missing-css-module-class",
              family: "css-modules",
              severity,
              confidence: reference.confidence,
              message: `CSS Module reference "${moduleLocalName}.${reference.className}" does not exist in "${cssFile.path}".`,
              primaryLocation: {
                filePath: sourceFile.path,
              },
              relatedLocations: [
                {
                  filePath: cssFile.path,
                },
              ],
              subject: {
                className: reference.className,
                cssFilePath: cssFile.path,
                sourceFilePath: sourceFile.path,
              },
              metadata: {
                moduleLocalName,
                cssModulePath: cssFile.path,
              },
            }),
          );
        }
      }

      return findings;
    },
  },
];
