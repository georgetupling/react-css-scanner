import { analyzeProjectModelWithStaticEngine } from "./analyzeProjectModelWithStaticEngine.js";
import {
  buildEngineDefinitionReachabilityBySourceFile,
  type EngineDefinitionReachabilityInfo,
} from "./buildEngineDefinitionReachability.js";
import { sortFindings } from "../../../runtime/findings.js";
import {
  getDeclaredExternalProviderForClass,
  getProjectClassDefinitions,
  isCssModuleFile,
  isCssModuleReference,
} from "../../../rules/helpers.js";
import { isPlainClassDefinition } from "../../../rules/cssDefinitionUtils.js";
import { getReferenceDefinitionCandidates } from "../../../rules/referenceMatching.js";
import { type DefinitionReachability } from "../../../rules/reachability.js";
import type { ProjectModel } from "../../../model/types.js";
import type { Finding, FindingSeverity } from "../../../runtime/types.js";
import type { RuleContext } from "../../../rules/types.js";

const MIGRATED_RULE_IDS = [
  "missing-css-class",
  "css-class-missing-in-some-contexts",
  "unreachable-css",
  "unused-css-class",
] as const;

type MigratedDefinitionAndUsageIntegrityRuleId = (typeof MIGRATED_RULE_IDS)[number];

const DEFAULT_RUNTIME_SEVERITIES: Record<
  MigratedDefinitionAndUsageIntegrityRuleId,
  FindingSeverity
> = {
  "missing-css-class": "info",
  "css-class-missing-in-some-contexts": "info",
  "unreachable-css": "info",
  "unused-css-class": "info",
};

const migratedDefinitionAndUsageIntegrityRuleCache = new WeakMap<
  ProjectModel,
  Map<MigratedDefinitionAndUsageIntegrityRuleId, Finding[]>
>();

export function getMigratedDefinitionAndUsageIntegrityRuleFindings(
  context: Pick<RuleContext, "model" | "createFinding" | "getRuleSeverity">,
  ruleId: MigratedDefinitionAndUsageIntegrityRuleId,
): Finding[] {
  const cachedFindings = migratedDefinitionAndUsageIntegrityRuleCache.get(context.model);
  if (cachedFindings) {
    return cachedFindings.get(ruleId) ?? [];
  }

  const findingsByRuleId = buildMigratedDefinitionAndUsageIntegrityRuleFindings(context);
  migratedDefinitionAndUsageIntegrityRuleCache.set(context.model, findingsByRuleId);
  return findingsByRuleId.get(ruleId) ?? [];
}

function buildMigratedDefinitionAndUsageIntegrityRuleFindings(
  context: Pick<RuleContext, "model" | "createFinding" | "getRuleSeverity">,
): Map<MigratedDefinitionAndUsageIntegrityRuleId, Finding[]> {
  const findingsByRuleId = new Map<MigratedDefinitionAndUsageIntegrityRuleId, Finding[]>(
    MIGRATED_RULE_IDS.map((ruleId) => [ruleId, []]),
  );
  const engineResult = analyzeProjectModelWithStaticEngine(context.model, {
    includeExternalCssSources: true,
  });
  const engineDefinitionReachabilityBySourceFile = buildEngineDefinitionReachabilityBySourceFile({
    model: context.model,
    moduleGraph: engineResult.moduleGraph,
    reachabilitySummary: engineResult.reachabilitySummary,
    externalCssSummary: engineResult.externalCssSummary,
  });
  const resolveReachability = (
    model: ProjectModel,
    sourceFilePath: string,
    cssFilePath: string,
    externalSpecifier?: string,
  ) =>
    getMigratedDefinitionReachabilityStatus({
      model,
      sourceFilePath,
      cssFilePath,
      externalSpecifier,
      engineDefinitionReachabilityBySourceFile,
    });
  const reachableCandidateUsageKeys = new Set<string>();

  for (const sourceFile of context.model.graph.sourceFiles) {
    for (const reference of sourceFile.classReferences) {
      if (isCssModuleReference(reference.kind)) {
        continue;
      }

      for (const candidate of getReferenceDefinitionCandidates(
        context.model,
        sourceFile.path,
        reference,
        {
          resolveReachability,
        },
      )) {
        if (candidate.reachability === "unreachable") {
          continue;
        }

        reachableCandidateUsageKeys.add(
          createCandidateUsageKey(candidate.cssFile, candidate.className),
        );
      }

      if (!reference.className) {
        continue;
      }

      const candidateDefinitions = getProjectClassDefinitions(context.model, reference.className);
      const migratedStatuses = candidateDefinitions.map((definition) =>
        resolveReachability(
          context.model,
          sourceFile.path,
          definition.cssFile,
          definition.externalSpecifier,
        ),
      );
      const sourceFileReachability = engineDefinitionReachabilityBySourceFile.get(sourceFile.path);

      const missingCssClassSeverity = context.getRuleSeverity(
        "missing-css-class",
        DEFAULT_RUNTIME_SEVERITIES["missing-css-class"],
      );
      if (missingCssClassSeverity !== "off" && candidateDefinitions.length === 0) {
        const declaredExternalProvider = getDeclaredExternalProviderForClass(
          context.model,
          reference.className,
        );
        const hasReachableRemoteExternalCss = [...(sourceFileReachability?.externalCss ?? [])].some(
          (specifier) => specifier.startsWith("http://") || specifier.startsWith("https://"),
        );
        if (!declaredExternalProvider && !hasReachableRemoteExternalCss) {
          findingsByRuleId.get("missing-css-class")?.push(
            context.createFinding({
              ruleId: "missing-css-class",
              family: "definition-and-usage-integrity",
              severity: missingCssClassSeverity,
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

      const cssClassMissingInSomeContextsSeverity = context.getRuleSeverity(
        "css-class-missing-in-some-contexts",
        DEFAULT_RUNTIME_SEVERITIES["css-class-missing-in-some-contexts"],
      );
      if (
        cssClassMissingInSomeContextsSeverity !== "off" &&
        candidateDefinitions.length > 0 &&
        !migratedStatuses.some((status) => isStrongerReachability(status))
      ) {
        const possibleDefinitions = candidateDefinitions.filter(
          (_, index) => migratedStatuses[index] === "render-context-possible",
        );
        if (possibleDefinitions.length > 0) {
          findingsByRuleId.get("css-class-missing-in-some-contexts")?.push(
            context.createFinding({
              ruleId: "css-class-missing-in-some-contexts",
              family: "definition-and-usage-integrity",
              severity: cssClassMissingInSomeContextsSeverity,
              confidence: "low",
              message: `Class "${reference.className}" is only backed by CSS in some known render contexts for "${sourceFile.path}".`,
              primaryLocation: {
                filePath: sourceFile.path,
                line: reference.line,
                column: reference.column,
              },
              relatedLocations: possibleDefinitions.map((definition) => ({
                filePath: definition.cssFile,
                line: definition.definition.line,
              })),
              subject: {
                className: reference.className,
                sourceFilePath: sourceFile.path,
              },
              metadata: {
                referenceKind: reference.kind,
                renderContextReachability: "possible",
                possibleRenderContextCssFiles: possibleDefinitions.map(
                  (definition) => definition.cssFile,
                ),
              },
            }),
          );
        }
      }

      const unreachableCssSeverity = context.getRuleSeverity(
        "unreachable-css",
        DEFAULT_RUNTIME_SEVERITIES["unreachable-css"],
      );
      if (
        unreachableCssSeverity !== "off" &&
        candidateDefinitions.length > 0 &&
        migratedStatuses.every((status) => status === "unreachable")
      ) {
        findingsByRuleId.get("unreachable-css")?.push(
          context.createFinding({
            ruleId: "unreachable-css",
            family: "definition-and-usage-integrity",
            severity: unreachableCssSeverity,
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
  }

  const unusedCssClassSeverity = context.getRuleSeverity(
    "unused-css-class",
    DEFAULT_RUNTIME_SEVERITIES["unused-css-class"],
  );
  if (unusedCssClassSeverity !== "off") {
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
              status: resolveReachability(context.model, entry.sourceFile, cssFile.path),
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

        if (
          reachableCandidateUsageKeys.has(
            createCandidateUsageKey(cssFile.path, definition.className),
          )
        ) {
          continue;
        }

        findingsByRuleId.get("unused-css-class")?.push(
          context.createFinding({
            ruleId: "unused-css-class",
            family: "definition-and-usage-integrity",
            severity: unusedCssClassSeverity,
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
  }

  for (const [ruleId, findings] of findingsByRuleId.entries()) {
    findingsByRuleId.set(ruleId, sortFindings(findings));
  }

  return findingsByRuleId;
}

function getMigratedDefinitionReachabilityStatus(input: {
  model: ProjectModel;
  sourceFilePath: string;
  cssFilePath: string;
  externalSpecifier?: string;
  engineDefinitionReachabilityBySourceFile: Map<string, EngineDefinitionReachabilityInfo>;
}): DefinitionReachability {
  const reachability = input.engineDefinitionReachabilityBySourceFile.get(input.sourceFilePath);
  if (!reachability) {
    return "unreachable";
  }

  if (input.externalSpecifier) {
    return reachability.externalCss.has(input.externalSpecifier) ? "direct" : "unreachable";
  }

  const cssFile = input.model.indexes.cssFileByPath.get(input.cssFilePath);
  if (!cssFile) {
    return "unreachable";
  }

  if (cssFile.category === "global") {
    return reachability.globalCss.has(input.cssFilePath) ? "direct" : "unreachable";
  }

  if (reachability.directLocalCss.has(input.cssFilePath)) {
    return "direct";
  }

  if (reachability.renderContextDefiniteLocalCss.has(input.cssFilePath)) {
    return "render-context-definite";
  }

  if (reachability.renderContextPossibleLocalCss.has(input.cssFilePath)) {
    return "render-context-possible";
  }

  if (reachability.importContextLocalCss.has(input.cssFilePath)) {
    return "import-context";
  }

  return "unreachable";
}

function isStrongerReachability(status: DefinitionReachability): boolean {
  return status === "direct" || status === "import-context" || status === "render-context-definite";
}

function createCandidateUsageKey(cssFilePath: string, className: string): string {
  return `${cssFilePath}::${className}`;
}
