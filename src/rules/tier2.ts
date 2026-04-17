import type { RuleDefinition } from "./types.js";
import {
  DYNAMIC_REFERENCE_KINDS,
  getAtRuleContextSignature,
  getDeclarationSignature,
  getDeclaredExternalProviderForClass,
  getOwningSourceFiles,
  getProjectClassDefinitions,
  getRuleNumberConfig,
  getUsingSourceFiles,
  isCssModuleFile,
  isCssModuleReference,
  isDefinitionReachable,
  isPlainClassDefinition,
  isSimpleRootClassDefinition,
} from "./helpers.js";

export const TIER_2_RULE_DEFINITIONS: RuleDefinition[] = [
  {
    ruleId: "empty-css-rule",
    family: "optimization-and-migration",
    defaultSeverity: "info",
    run(context) {
      const severity = context.getRuleSeverity("empty-css-rule", "info");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const cssFile of context.model.graph.cssFiles) {
        for (const styleRule of cssFile.styleRules) {
          if (styleRule.declarations.length > 0) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "empty-css-rule",
              family: "optimization-and-migration",
              severity,
              confidence: "high",
              message: `Selector "${styleRule.selector}" in "${cssFile.path}" does not contain any CSS declarations.`,
              primaryLocation: {
                filePath: cssFile.path,
                line: styleRule.line,
              },
              subject: {
                cssFilePath: cssFile.path,
              },
              metadata: {
                selector: styleRule.selector,
                atRuleContext: styleRule.atRuleContext.map((entry) => ({
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
    ruleId: "redundant-css-declaration-block",
    family: "optimization-and-migration",
    defaultSeverity: "info",
    run(context) {
      const severity = context.getRuleSeverity("redundant-css-declaration-block", "info");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const cssFile of context.model.graph.cssFiles) {
        if (isCssModuleFile(context.model, cssFile.path)) {
          continue;
        }

        const comparableRules = cssFile.styleRules.filter((styleRule) => {
          if (styleRule.declarations.length === 0 || styleRule.selectorBranches.length !== 1) {
            return false;
          }

          const selectorBranch = styleRule.selectorBranches[0];
          return (
            selectorBranch.matchKind === "standalone" &&
            !selectorBranch.hasUnknownSemantics &&
            !selectorBranch.hasSubjectModifiers &&
            selectorBranch.subjectClassNames.length === 1
          );
        });

        const duplicateGroups = new Map<string, typeof comparableRules>();
        for (const styleRule of comparableRules) {
          const selectorBranch = styleRule.selectorBranches[0];
          const className = selectorBranch.subjectClassNames[0];
          const groupKey = [
            className,
            styleRule.selector,
            getAtRuleContextSignature(styleRule.atRuleContext),
            getDeclarationSignature(styleRule.declarations),
          ].join("::");
          const existingGroup = duplicateGroups.get(groupKey) ?? [];
          existingGroup.push(styleRule);
          duplicateGroups.set(groupKey, existingGroup);
        }

        for (const [groupKey, styleRules] of duplicateGroups.entries()) {
          if (styleRules.length < 2) {
            continue;
          }

          const [className, selector, atRuleContextSignature, declarationSignature] =
            groupKey.split("::");
          const sortedRules = [...styleRules].sort((left, right) => left.line - right.line);

          findings.push(
            context.createFinding({
              ruleId: "redundant-css-declaration-block",
              family: "optimization-and-migration",
              severity,
              confidence: "high",
              message: `Class "${className}" repeats the same CSS declarations in the same selector and at-rule context.`,
              primaryLocation: {
                filePath: cssFile.path,
                line: sortedRules[0].line,
              },
              relatedLocations: sortedRules.slice(1).map((styleRule) => ({
                filePath: cssFile.path,
                line: styleRule.line,
              })),
              subject: {
                className,
                cssFilePath: cssFile.path,
              },
              metadata: {
                selector,
                declarationSignature,
                atRuleContextSignature,
                duplicateLocations: sortedRules.map((styleRule) => ({
                  filePath: cssFile.path,
                  line: styleRule.line,
                  selector: styleRule.selector,
                  atRuleContext: styleRule.atRuleContext.map((entry) => ({
                    name: entry.name,
                    params: entry.params,
                  })),
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
    ruleId: "page-style-used-by-single-component",
    family: "ownership-and-organization",
    defaultSeverity: "info",
    run(context) {
      const severity = context.getRuleSeverity("page-style-used-by-single-component", "info");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const cssFile of context.model.graph.cssFiles) {
        if (cssFile.ownership !== "page") {
          continue;
        }

        const usingSources = [...getUsingSourceFiles(context.model, cssFile)].sort((left, right) =>
          left.localeCompare(right),
        );
        if (usingSources.length !== 1) {
          continue;
        }

        findings.push(
          context.createFinding({
            ruleId: "page-style-used-by-single-component",
            family: "ownership-and-organization",
            severity,
            confidence: "medium",
            message: `Page-level CSS "${cssFile.path}" is effectively serving a single source file and may belong closer to that component.`,
            primaryLocation: {
              filePath: cssFile.path,
            },
            relatedLocations: usingSources.map((sourceFile) => ({ filePath: sourceFile })),
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
    ruleId: "dynamic-missing-css-class",
    family: "dynamic-analysis",
    defaultSeverity: "warning",
    run(context) {
      const severity = context.getRuleSeverity("dynamic-missing-css-class", "warning");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const sourceFile of context.model.graph.sourceFiles) {
        for (const reference of sourceFile.classReferences) {
          if (
            isCssModuleReference(reference.kind) ||
            !DYNAMIC_REFERENCE_KINDS.has(reference.kind)
          ) {
            continue;
          }

          const candidateDefinitions = reference.className
            ? getProjectClassDefinitions(context.model, reference.className)
            : [];
          const reachableDefinitions = reference.className
            ? candidateDefinitions.filter((definition) =>
                isDefinitionReachable(
                  context.model,
                  sourceFile.path,
                  definition.cssFile,
                  definition.externalSpecifier,
                ),
              )
            : [];

          if (candidateDefinitions.length > 0 || reachableDefinitions.length > 0) {
            continue;
          }

          if (
            reference.className &&
            getDeclaredExternalProviderForClass(context.model, reference.className)
          ) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "dynamic-missing-css-class",
              family: "dynamic-analysis",
              severity,
              confidence: reference.confidence,
              message: reference.className
                ? `Dynamic class "${reference.className}" appears likely to be referenced, but no matching CSS definition could be confirmed.`
                : `A dynamically composed class in "${sourceFile.path}" could not be resolved to a confirmed CSS definition.`,
              primaryLocation: {
                filePath: sourceFile.path,
                line: reference.line,
                column: reference.column,
              },
              subject: reference.className
                ? {
                    className: reference.className,
                    sourceFilePath: sourceFile.path,
                  }
                : {
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
                (entry) =>
                  entry.localName === moduleLocalName && entry.resolvedPath === cssFile.path,
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
  },
  {
    ruleId: "missing-external-css-class",
    family: "external-css",
    defaultSeverity: "error",
    run(context) {
      const severity = context.getRuleSeverity("missing-external-css-class", "error");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const sourceFile of context.model.graph.sourceFiles) {
        const reachability = context.model.reachability.get(sourceFile.path);
        if (!reachability || reachability.externalCss.size === 0) {
          continue;
        }

        for (const reference of sourceFile.classReferences) {
          if (!reference.className || isCssModuleReference(reference.kind)) {
            continue;
          }

          const definitions = (
            context.model.indexes.classDefinitionsByName.get(reference.className) ?? []
          ).filter((definition) => isPlainClassDefinition(definition.definition));
          const reachableExternalDefinitions = definitions.filter(
            (definition) =>
              definition.externalSpecifier &&
              isDefinitionReachable(
                context.model,
                sourceFile.path,
                definition.cssFile,
                definition.externalSpecifier,
              ),
          );

          if (reachableExternalDefinitions.length > 0) {
            continue;
          }

          const reachableProjectDefinitions = definitions.filter(
            (definition) =>
              !definition.externalSpecifier &&
              isDefinitionReachable(context.model, sourceFile.path, definition.cssFile),
          );

          if (reachableProjectDefinitions.length > 0) {
            continue;
          }

          const declaredExternalProvider = getDeclaredExternalProviderForClass(
            context.model,
            reference.className,
          );
          if (declaredExternalProvider) {
            continue;
          }

          findings.push(
            context.createFinding({
              ruleId: "missing-external-css-class",
              family: "external-css",
              severity,
              confidence: reference.confidence,
              message: `Class "${reference.className}" appears intended to come from imported external CSS, but no matching imported external stylesheet definition was found.`,
              primaryLocation: {
                filePath: sourceFile.path,
                line: reference.line,
                column: reference.column,
              },
              relatedLocations: [...reachability.externalCss]
                .sort((left, right) => left.localeCompare(right))
                .map((specifier) => ({ filePath: specifier })),
              subject: {
                className: reference.className,
                sourceFilePath: sourceFile.path,
              },
              metadata: {
                externalCssSpecifiers: [...reachability.externalCss].sort((left, right) =>
                  left.localeCompare(right),
                ),
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
    ruleId: "duplicate-css-class-definition",
    family: "optimization-and-migration",
    defaultSeverity: "warning",
    run(context) {
      const severity = context.getRuleSeverity("duplicate-css-class-definition", "warning");
      if (severity === "off") {
        return [];
      }

      const findings = [];

      for (const [
        className,
        definitions,
      ] of context.model.indexes.classDefinitionsByName.entries()) {
        const projectDefinitions = definitions.filter(
          (definition) =>
            !definition.externalSpecifier &&
            !isCssModuleFile(context.model, definition.cssFile) &&
            isSimpleRootClassDefinition(definition.definition),
        );

        if (projectDefinitions.length < 2) {
          continue;
        }

        const definitionsByAtRuleContext = new Map<string, typeof projectDefinitions>();
        for (const definition of projectDefinitions) {
          const atRuleContextSignature = getAtRuleContextSignature(
            definition.definition.atRuleContext,
          );
          const existingDefinitions = definitionsByAtRuleContext.get(atRuleContextSignature) ?? [];
          existingDefinitions.push(definition);
          definitionsByAtRuleContext.set(atRuleContextSignature, existingDefinitions);
        }

        for (const [atRuleContextSignature, comparableDefinitions] of definitionsByAtRuleContext) {
          if (comparableDefinitions.length < 2) {
            continue;
          }

          const sortedDefinitions = [...comparableDefinitions].sort((left, right) => {
            if (left.cssFile === right.cssFile) {
              return left.definition.line - right.definition.line;
            }

            return left.cssFile.localeCompare(right.cssFile);
          });

          const duplicateCssFiles = [
            ...new Set(sortedDefinitions.map((definition) => definition.cssFile)),
          ].sort((left, right) => left.localeCompare(right));

          findings.push(
            context.createFinding({
              ruleId: "duplicate-css-class-definition",
              family: "optimization-and-migration",
              severity,
              confidence: "high",
              message: `Class "${className}" is defined in multiple locations in project CSS, which may be confusing or redundant.`,
              primaryLocation: {
                filePath: sortedDefinitions[0].cssFile,
                line: sortedDefinitions[0].definition.line,
              },
              relatedLocations: sortedDefinitions.slice(1).map((definition) => ({
                filePath: definition.cssFile,
                line: definition.definition.line,
              })),
              subject: {
                className,
                cssFilePath: sortedDefinitions[0].cssFile,
              },
              metadata: {
                duplicateCssFiles,
                atRuleContextSignature,
                duplicateLocations: sortedDefinitions.map((definition) => ({
                  filePath: definition.cssFile,
                  line: definition.definition.line,
                  selector: definition.definition.selector,
                  atRuleContext: definition.definition.atRuleContext.map((entry) => ({
                    name: entry.name,
                    params: entry.params,
                  })),
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
  },
];
