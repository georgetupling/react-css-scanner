import type { RuleDefinition } from "./types.js";
import type { CssClassDefinitionFact, CssDeclarationFact } from "../facts/types.js";
import {
  DYNAMIC_REFERENCE_KINDS,
  getAtRuleContextSignature,
  getDeclaredExternalProviderForClass,
  getOwningSourceFiles,
  getProjectClassDefinitions,
  getRuleNumberConfig,
  getUsingSourceFiles,
  isPlainClassDefinition,
  isSimpleRootClassDefinition,
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

      const maxUtilityClasses = getRuleNumberConfig(
        context.model,
        "utility-class-replacement",
        "maxUtilityClasses",
        3,
      );

      const utilityDefinitions = context.model.graph.cssFiles
        .filter((cssFile) => cssFile.ownership === "utility")
        .flatMap((cssFile) =>
          cssFile.classDefinitions
            .filter((definition) => isSimpleRootClassDefinition(definition))
            .map((definition) => ({
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
          if (!isSimpleRootClassDefinition(definition)) {
            continue;
          }

          const definitionAtRuleContextSignature = getAtRuleContextSignature(
            definition.atRuleContext,
          );
          const hasCrossContextVariants = cssFile.classDefinitions.some((candidate) => {
            if (
              !isSimpleRootClassDefinition(candidate) ||
              candidate.className !== definition.className
            ) {
              return false;
            }

            return (
              getAtRuleContextSignature(candidate.atRuleContext) !==
              definitionAtRuleContextSignature
            );
          });
          if (hasCrossContextVariants) {
            continue;
          }

          const targetDeclarations = getEffectiveDeclarations(definition.declarationDetails);

          const candidateUtilities = utilityDefinitions
            .filter(
              (utilityDefinition) =>
                utilityDefinition.definition.className !== definition.className,
            )
            .filter((utilityDefinition) => {
              const utilityAtRuleContextSignature = getAtRuleContextSignature(
                utilityDefinition.definition.atRuleContext,
              );
              if (utilityAtRuleContextSignature !== definitionAtRuleContextSignature) {
                return false;
              }

              const utilityDeclarations = getEffectiveDeclarations(
                utilityDefinition.definition.declarationDetails,
              );
              return (
                utilityDeclarations.length > 0 &&
                utilityDeclarations.every((utilityDeclaration) =>
                  targetDeclarations.some(
                    (targetDeclaration) =>
                      targetDeclaration.property === utilityDeclaration.property &&
                      targetDeclaration.value === utilityDeclaration.value,
                  ),
                )
              );
            })
            .map((utilityDefinition) => ({
              cssFile: utilityDefinition.cssFile,
              definition: utilityDefinition.definition,
              declarations: getEffectiveDeclarations(
                utilityDefinition.definition.declarationDetails,
              ),
            }))
            .sort((left, right) => {
              if (right.declarations.length !== left.declarations.length) {
                return right.declarations.length - left.declarations.length;
              }

              return left.definition.className.localeCompare(right.definition.className);
            });

          const bestMatch = findUtilityComposition(
            targetDeclarations,
            candidateUtilities,
            maxUtilityClasses,
          );

          if (!bestMatch) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "utility-class-replacement",
              family: "optimization-and-migration",
              severity,
              confidence: "medium",
              message: `Class "${definition.className}" may be replaceable with utility classes ${formatUtilityClassList(bestMatch.map((entry) => entry.definition.className))}.`,
              primaryLocation: {
                filePath: cssFile.path,
                line: definition.line,
              },
              relatedLocations: bestMatch.map((entry) => ({
                filePath: entry.cssFile,
                line: entry.definition.line,
              })),
              subject: {
                className: definition.className,
                cssFilePath: cssFile.path,
              },
              metadata: {
                utilityClassNames: bestMatch.map((entry) => entry.definition.className),
                utilityCssFiles: [...new Set(bestMatch.map((entry) => entry.cssFile))],
                declarationOverlap: targetDeclarations.length,
                utilityClassCount: bestMatch.length,
                atRuleContext: definition.atRuleContext.map((entry) => ({
                  name: entry.name,
                  params: entry.params,
                })),
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
                line: reference.line,
                column: reference.column,
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
                line: reference.line,
                column: reference.column,
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

type EffectiveUtilityDefinition = {
  cssFile: string;
  definition: CssClassDefinitionFact;
  declarations: CssDeclarationFact[];
};

function getEffectiveDeclarations(declarations: CssDeclarationFact[]): CssDeclarationFact[] {
  const declarationMap = new Map<string, string>();

  for (const declaration of declarations) {
    declarationMap.set(declaration.property, declaration.value);
  }

  return [...declarationMap.entries()]
    .map(([property, value]) => ({ property, value }))
    .sort((left, right) => left.property.localeCompare(right.property));
}

function findUtilityComposition(
  targetDeclarations: CssDeclarationFact[],
  utilityDefinitions: EffectiveUtilityDefinition[],
  maxUtilityClasses: number,
): EffectiveUtilityDefinition[] | undefined {
  const remainingProperties = new Set(
    targetDeclarations.map((declaration) => declaration.property),
  );

  for (let utilityCount = 1; utilityCount <= maxUtilityClasses; utilityCount += 1) {
    const match = searchUtilityComposition(
      utilityDefinitions,
      remainingProperties,
      [],
      0,
      utilityCount,
    );
    if (match) {
      return match;
    }
  }

  return undefined;
}

function searchUtilityComposition(
  utilityDefinitions: EffectiveUtilityDefinition[],
  remainingProperties: Set<string>,
  selectedDefinitions: EffectiveUtilityDefinition[],
  startIndex: number,
  remainingSlots: number,
): EffectiveUtilityDefinition[] | undefined {
  if (remainingProperties.size === 0) {
    return [...selectedDefinitions].sort((left, right) =>
      left.definition.className.localeCompare(right.definition.className),
    );
  }

  if (remainingSlots === 0) {
    return undefined;
  }

  for (let index = startIndex; index < utilityDefinitions.length; index += 1) {
    const utilityDefinition = utilityDefinitions[index];
    const coveredProperties = utilityDefinition.declarations
      .map((declaration) => declaration.property)
      .filter((property) => remainingProperties.has(property));

    if (coveredProperties.length === 0) {
      continue;
    }

    const nextRemainingProperties = new Set(remainingProperties);
    for (const property of coveredProperties) {
      nextRemainingProperties.delete(property);
    }

    const nextSelectedDefinitions = [...selectedDefinitions, utilityDefinition];
    const match = searchUtilityComposition(
      utilityDefinitions,
      nextRemainingProperties,
      nextSelectedDefinitions,
      index + 1,
      remainingSlots - 1,
    );

    if (match) {
      return match;
    }
  }

  return undefined;
}

function formatUtilityClassList(classNames: string[]): string {
  return classNames.map((className) => `"${className}"`).join(", ");
}
