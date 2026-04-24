import type { ClassReferenceFact, CssClassDefinitionFact } from "../facts/types.js";
import type { ProjectModel } from "../model/types.js";
import { isPlainClassDefinition } from "./cssDefinitionUtils.js";
import {
  getDefinitionReachabilityStatus,
  type DefinitionReachability,
  compareReachability,
} from "./reachability.js";
import { getProjectClassDefinitions, isCssModuleFile } from "./helpers.js";

type ReachabilityResolver = (
  model: ProjectModel,
  sourceFilePath: string,
  cssFilePath: string,
  externalSpecifier?: string,
) => DefinitionReachability;

export type ReferenceMatchEvidence = "exact" | "partial-template-match";

export type ReferenceDefinitionCandidate = {
  className: string;
  cssFile: string;
  externalSpecifier?: string;
  ownership: import("../model/types.js").CssOwnership;
  category: import("../model/types.js").CssResourceCategory;
  definition: CssClassDefinitionFact;
  matchEvidence: ReferenceMatchEvidence;
  reachability: DefinitionReachability;
};

export function getReferenceDefinitionCandidates(
  model: ProjectModel,
  sourceFilePath: string,
  reference: ClassReferenceFact,
  options: {
    resolveReachability?: ReachabilityResolver;
  } = {},
): ReferenceDefinitionCandidate[] {
  const candidates: ReferenceDefinitionCandidate[] = [];
  const seen = new Set<string>();
  const resolveReachability = options.resolveReachability ?? getDefinitionReachabilityStatus;

  if (reference.className) {
    for (const definition of getProjectClassDefinitions(model, reference.className)) {
      const reachability = resolveReachability(
        model,
        sourceFilePath,
        definition.cssFile,
        definition.externalSpecifier,
      );

      const key = createReferenceDefinitionCandidateKey(
        definition.cssFile,
        definition.definition.className,
        definition.externalSpecifier,
      );
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({
        className: definition.definition.className,
        cssFile: definition.cssFile,
        externalSpecifier: definition.externalSpecifier,
        ownership: definition.ownership,
        category: definition.category,
        definition: definition.definition,
        matchEvidence: "exact",
        reachability,
      });
    }
  }

  for (const definition of getPartialTemplateDefinitionCandidates(
    model,
    sourceFilePath,
    reference,
    { resolveReachability },
  )) {
    const key = createReferenceDefinitionCandidateKey(
      definition.cssFile,
      definition.definition.className,
      definition.externalSpecifier,
    );
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(definition);
  }

  return candidates.sort(compareReferenceDefinitionCandidates);
}

export function getPartialTemplateDefinitionCandidates(
  model: ProjectModel,
  sourceFilePath: string,
  reference: ClassReferenceFact,
  options: {
    resolveReachability?: ReachabilityResolver;
  } = {},
): ReferenceDefinitionCandidate[] {
  if (
    reference.kind !== "template-literal" ||
    !model.config.classComposition.partialTemplateMatching.enabled
  ) {
    return [];
  }

  const partialPattern = getPartialTemplatePatternMetadata(reference.metadata);
  if (!partialPattern) {
    return [];
  }

  const candidates: ReferenceDefinitionCandidate[] = [];
  const resolveReachability = options.resolveReachability ?? getDefinitionReachabilityStatus;

  for (const [className, definitions] of model.indexes.classDefinitionsByName.entries()) {
    if (!matchesPartialTemplatePattern(className, partialPattern)) {
      continue;
    }

    for (const definition of definitions) {
      if (
        isCssModuleFile(model, definition.cssFile) ||
        !isPlainClassDefinition(definition.definition)
      ) {
        continue;
      }

      const reachability = resolveReachability(
        model,
        sourceFilePath,
        definition.cssFile,
        definition.externalSpecifier,
      );
      if (reachability === "unreachable") {
        continue;
      }

      candidates.push({
        className: definition.definition.className,
        cssFile: definition.cssFile,
        externalSpecifier: definition.externalSpecifier,
        ownership: definition.ownership,
        category: definition.category,
        definition: definition.definition,
        matchEvidence: "partial-template-match",
        reachability,
      });
      if (candidates.length > model.config.classComposition.partialTemplateMatching.maxCandidates) {
        return [];
      }
    }
  }

  return candidates;
}

export function getPartialTemplatePatternMetadata(metadata: Record<string, unknown> | undefined):
  | {
      prefix?: string;
      suffix?: string;
    }
  | undefined {
  const candidate = metadata?.partialTemplatePattern;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const pattern = candidate as Record<string, unknown>;
  const prefix = typeof pattern.prefix === "string" ? pattern.prefix : undefined;
  const suffix = typeof pattern.suffix === "string" ? pattern.suffix : undefined;

  if (!prefix && !suffix) {
    return undefined;
  }

  return {
    prefix,
    suffix,
  };
}

export function matchesPartialTemplatePattern(
  className: string,
  pattern: {
    prefix?: string;
    suffix?: string;
  },
): boolean {
  if (pattern.prefix && !className.startsWith(pattern.prefix)) {
    return false;
  }

  if (pattern.suffix && !className.endsWith(pattern.suffix)) {
    return false;
  }

  return true;
}

export function createReferenceDefinitionCandidateKey(
  cssFilePath: string,
  className: string,
  externalSpecifier?: string,
): string {
  return `${cssFilePath}::${className}::${externalSpecifier ?? ""}`;
}

export function compareReferenceDefinitionCandidates(
  left: ReferenceDefinitionCandidate,
  right: ReferenceDefinitionCandidate,
): number {
  if (left.className === right.className) {
    if (left.cssFile === right.cssFile) {
      return compareReachability(left.reachability, right.reachability);
    }

    return left.cssFile.localeCompare(right.cssFile);
  }

  return left.className.localeCompare(right.className);
}
