import type {
  ClassReferenceAnalysis,
  ProjectAnalysisBuildInput,
  ProviderClassSatisfactionRelation,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
} from "../../project-analysis/index.js";
import { collectReferenceClassNames, compareById, mergeTraces } from "../internal/shared.js";

export function buildProviderClassSatisfactions(input: {
  references: ClassReferenceAnalysis[];
  input: ProjectAnalysisBuildInput;
  includeTraces: boolean;
}): ProviderClassSatisfactionRelation[] {
  const relations: ProviderClassSatisfactionRelation[] = [];

  for (const reference of input.references) {
    for (const className of collectReferenceClassNames(reference)) {
      for (const provider of input.input.externalCssSummary.activeProviders) {
        const satisfied =
          provider.classNames.includes(className) ||
          provider.classPrefixes.some((classPrefix) => className.startsWith(classPrefix));
        if (!satisfied) {
          continue;
        }

        relations.push({
          id: `provider-class:${reference.id}:${provider.provider}:${className}`,
          referenceId: reference.id,
          className,
          referenceClassKind: reference.definiteClassNames.includes(className)
            ? "definite"
            : "possible",
          provider: provider.provider,
          reasons: [`class "${className}" is declared by active external CSS provider`],
          traces: input.includeTraces ? [...reference.traces] : [],
        });
      }
    }
  }

  return relations.sort(compareById);
}

export function buildSelectorMatches(
  selectorQueries: SelectorQueryAnalysis[],
  includeTraces: boolean,
): SelectorMatchRelation[] {
  return selectorQueries
    .filter((selectorQuery) => selectorQuery.sourceResult.reachability?.kind === "css-source")
    .map((selectorQuery) => {
      const reachability =
        selectorQuery.sourceResult.reachability?.kind === "css-source"
          ? selectorQuery.sourceResult.reachability
          : undefined;

      return {
        id: `selector-match:${selectorQuery.id}`,
        selectorQueryId: selectorQuery.id,
        stylesheetId: selectorQuery.stylesheetId,
        availability: reachability?.availability,
        outcome: selectorQuery.outcome,
        contextCount: reachability?.contexts.length ?? 0,
        matchedContextCount: reachability?.matchedContexts?.length ?? 0,
        reasons: reachability?.reasons ?? selectorQuery.sourceResult.reasons,
        traces: includeTraces
          ? mergeTraces([
              ...selectorQuery.traces,
              ...(reachability?.contexts.flatMap((context) => context.traces) ?? []),
              ...(reachability?.matchedContexts?.flatMap((context) => context.traces) ?? []),
            ])
          : [],
      };
    })
    .sort(compareById);
}
