import { analyzeProjectModelWithStaticEngine } from "./analyzeProjectModelWithStaticEngine.js";
import { buildEngineRenderContextReachabilityBySourceFile } from "./buildEngineRenderContextReachability.js";
import { sortFindings } from "../../../runtime/findings.js";
import {
  getDeclaredExternalProviderForClass,
  getProjectClassDefinitions,
  isCssModuleReference,
} from "../../../rules/helpers.js";
import {
  getDefinitionReachabilityStatus,
  type DefinitionReachability,
} from "../../../rules/reachability.js";
import type { ProjectModel } from "../../../model/types.js";
import type { Finding, FindingSeverity } from "../../../runtime/types.js";
import type { RuleContext } from "../../../rules/types.js";

const MIGRATED_RULE_IDS = [
  "missing-css-class",
  "css-class-missing-in-some-contexts",
  "unreachable-css",
] as const;

type MigratedDefinitionAndUsageIntegrityRuleId = (typeof MIGRATED_RULE_IDS)[number];

const DEFAULT_RUNTIME_SEVERITIES: Record<
  MigratedDefinitionAndUsageIntegrityRuleId,
  FindingSeverity
> = {
  "missing-css-class": "info",
  "css-class-missing-in-some-contexts": "info",
  "unreachable-css": "info",
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
  if (context.model.facts.sourceFacts.length === 0) {
    return findingsByRuleId;
  }

  // Warm the shared static-analysis-engine cache for this project while
  // preserving compatibility fallbacks only where the current engine route model
  // still does not publish a safe replacement status.
  const engineResult = analyzeProjectModelWithStaticEngine(context.model, {
    includeExternalCssSources: true,
  });
  const engineRenderContextReachabilityBySourceFile =
    buildEngineRenderContextReachabilityBySourceFile(context.model, engineResult.renderGraph);

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
      const migratedStatuses = candidateDefinitions.map((definition) =>
        getMigratedDefinitionReachabilityStatus({
          model: context.model,
          sourceFilePath: sourceFile.path,
          cssFilePath: definition.cssFile,
          externalSpecifier: definition.externalSpecifier,
          engineRenderContextReachabilityBySourceFile,
        }),
      );

      const missingCssClassSeverity = context.getRuleSeverity(
        "missing-css-class",
        DEFAULT_RUNTIME_SEVERITIES["missing-css-class"],
      );
      if (missingCssClassSeverity !== "off" && candidateDefinitions.length === 0) {
        const declaredExternalProvider = getDeclaredExternalProviderForClass(
          context.model,
          reference.className,
        );
        const hasReachableRemoteExternalCss = [...reachability.externalCss].some(
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
  engineRenderContextReachabilityBySourceFile: Map<
    string,
    {
      renderContextDefiniteLocalCss: Set<string>;
      renderContextPossibleLocalCss: Set<string>;
    }
  >;
}): DefinitionReachability {
  const compatibilityStatus = getDefinitionReachabilityStatus(
    input.model,
    input.sourceFilePath,
    input.cssFilePath,
    input.externalSpecifier,
  );
  if (compatibilityStatus === "direct" || compatibilityStatus === "import-context") {
    return compatibilityStatus;
  }

  if (input.externalSpecifier) {
    return compatibilityStatus;
  }

  const cssFile = input.model.indexes.cssFileByPath.get(input.cssFilePath);
  if (cssFile?.category === "global") {
    return compatibilityStatus;
  }

  const engineRenderContextReachability = input.engineRenderContextReachabilityBySourceFile.get(
    input.sourceFilePath,
  );
  if (engineRenderContextReachability?.renderContextDefiniteLocalCss.has(input.cssFilePath)) {
    return "render-context-definite";
  }

  if (engineRenderContextReachability?.renderContextPossibleLocalCss.has(input.cssFilePath)) {
    return "render-context-possible";
  }

  if (
    compatibilityStatus === "render-context-definite" ||
    compatibilityStatus === "render-context-possible"
  ) {
    return compatibilityStatus;
  }

  return "unreachable";
}

function isStrongerReachability(status: DefinitionReachability): boolean {
  return status === "direct" || status === "import-context" || status === "render-context-definite";
}
