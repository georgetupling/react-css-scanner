import type { CssClassDefinitionFact, CssDeclarationFact } from "../../facts/types.js";
import type { RuleDefinition } from "../types.js";
import {
  getAtRuleContextSignature,
  getRuleNumberConfig,
  isCssModuleFile,
  isSimpleRootClassDefinition,
} from "../helpers.js";

export const utilityClassReplacementRule: RuleDefinition = {
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
            getAtRuleContextSignature(candidate.atRuleContext) !== definitionAtRuleContextSignature
          );
        });
        if (hasCrossContextVariants) {
          continue;
        }

        const targetDeclarations = getEffectiveDeclarations(definition.declarationDetails);

        const candidateUtilities = utilityDefinitions
          .filter(
            (utilityDefinition) => utilityDefinition.definition.className !== definition.className,
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
            declarations: getEffectiveDeclarations(utilityDefinition.definition.declarationDetails),
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
};

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
