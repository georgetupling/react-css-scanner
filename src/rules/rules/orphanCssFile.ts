import type {
  AnalysisTrace,
  StylesheetAnalysis,
  StylesheetReachabilityRelation,
} from "../../static-analysis-engine/index.js";
import {
  getClassDefinitionsByStylesheetId,
  getProviderBackedStylesheetRelationsByStylesheetId,
  getStylesheetReachabilityByStylesheetId,
} from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  isIntentionallySharedStylesheetPath,
  isStylesheetIntentionallySharedByPolicy,
} from "./ownershipRuleUtils.js";

export const orphanCssFileRule: RuleDefinition = {
  id: "orphan-css-file",
  run(context) {
    return runOrphanCssFileRule(context);
  },
};

function runOrphanCssFileRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysisEvidence.projectEvidence.entities.stylesheets
    .filter((stylesheet) => isReportableOrphanStylesheet({ context, stylesheet }))
    .map((stylesheet) => buildOrphanCssFileFinding({ context, stylesheet }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function isReportableOrphanStylesheet(input: {
  context: RuleContext;
  stylesheet: StylesheetAnalysis;
}): boolean {
  if (input.stylesheet.origin !== "project-css") {
    return false;
  }
  if (
    getClassDefinitionsByStylesheetId(input.context.analysisEvidence, input.stylesheet.id)
      .length === 0
  ) {
    return false;
  }
  if (
    getProviderBackedStylesheetRelationsByStylesheetId(
      input.context.analysisEvidence,
      input.stylesheet.id,
    ).some((relation) => relation.suppressUnused)
  ) {
    return false;
  }
  if (
    isStylesheetIntentionallySharedByPolicy({
      context: input.context,
      stylesheetId: input.stylesheet.id,
    }) ||
    isIntentionallySharedStylesheetPath({
      filePath: input.stylesheet.filePath,
      sharedCssPatterns: input.context.config.ownership.sharedCss,
    })
  ) {
    return false;
  }

  const reachability = getStylesheetReachabilityByStylesheetId(
    input.context.analysisEvidence,
    input.stylesheet.id,
  );
  return reachability.every((relation) => relation.availability === "unavailable");
}

function buildOrphanCssFileFinding(input: {
  context: RuleContext;
  stylesheet: StylesheetAnalysis;
}): UnresolvedFinding {
  const definitions = getClassDefinitionsByStylesheetId(
    input.context.analysisEvidence,
    input.stylesheet.id,
  );
  const reachability = getStylesheetReachabilityByStylesheetId(
    input.context.analysisEvidence,
    input.stylesheet.id,
  );
  const firstDefinition = definitions[0];

  return {
    id: `orphan-css-file:${input.stylesheet.id}`,
    ruleId: "orphan-css-file",
    confidence: "high",
    message: `Stylesheet "${input.stylesheet.filePath ?? input.stylesheet.id}" defines CSS classes but is not reachable from any analyzed React source.`,
    subject: {
      kind: "stylesheet",
      id: input.stylesheet.id,
    },
    location: input.stylesheet.filePath
      ? {
          filePath: input.stylesheet.filePath,
          startLine: firstDefinition?.line ?? 1,
          startColumn: 1,
        }
      : undefined,
    evidence: [
      {
        kind: "stylesheet",
        id: input.stylesheet.id,
      },
      ...definitions.slice(0, 10).map((definition) => ({
        kind: "class-definition" as const,
        id: definition.id,
      })),
    ],
    traces:
      input.context.includeTraces === false
        ? []
        : buildOrphanCssFileTraces({ stylesheet: input.stylesheet, reachability }),
    data: {
      stylesheetId: input.stylesheet.id,
      stylesheetFilePath: input.stylesheet.filePath,
      classDefinitionCount: definitions.length,
      classNames: [...new Set(definitions.map((definition) => definition.className))].sort(
        (left, right) => left.localeCompare(right),
      ),
      reachabilityReasons: [...new Set(reachability.flatMap((relation) => relation.reasons))].sort(
        (left, right) => left.localeCompare(right),
      ),
    },
  };
}

function buildOrphanCssFileTraces(input: {
  stylesheet: StylesheetAnalysis;
  reachability: StylesheetReachabilityRelation[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:orphan-css-file:${input.stylesheet.id}`,
      category: "rule-evaluation",
      summary: `stylesheet "${input.stylesheet.filePath ?? input.stylesheet.id}" had no reachable source or component contexts`,
      anchor: input.stylesheet.filePath
        ? {
            filePath: input.stylesheet.filePath,
            startLine: 1,
            startColumn: 1,
          }
        : undefined,
      children: input.reachability.flatMap((relation) => relation.traces),
      metadata: {
        ruleId: "orphan-css-file",
        stylesheetId: input.stylesheet.id,
        stylesheetFilePath: input.stylesheet.filePath,
      },
    },
  ];
}
