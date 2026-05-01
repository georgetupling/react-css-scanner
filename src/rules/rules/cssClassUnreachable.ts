import type {
  AnalysisTrace,
  ClassReferenceAnalysis,
  ClassReferenceMatchRelation,
} from "../../static-analysis-engine/index.js";
import {
  getClassDefinitionsByClassName,
  getClassReferences,
  getComponentById,
  getReferenceMatchesByReferenceAndClassName,
  getStylesheetById,
  hasProviderSatisfactionForReferenceClass,
} from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const cssClassUnreachableRule: RuleDefinition = {
  id: "css-class-unreachable",
  run(context) {
    return runCssClassUnreachableRule(context);
  },
};

function runCssClassUnreachableRule(context: RuleContext): UnresolvedFinding[] {
  const findings: UnresolvedFinding[] = [];

  for (const reference of getClassReferences(context.analysisEvidence)) {
    for (const className of reference.definiteClassNames) {
      if (
        hasProviderSatisfactionForReferenceClass({
          analysis: context.analysisEvidence,
          referenceId: reference.id,
          className,
        })
      ) {
        continue;
      }

      const definitions = getClassDefinitionsByClassName(context.analysisEvidence, className);
      if (definitions.length === 0) {
        continue;
      }

      const matches = getReferenceMatchesByReferenceAndClassName(
        context.analysisEvidence,
        reference.id,
        className,
      );
      if (matches.length === 0) {
        continue;
      }
      if (
        matches.some(
          (match) => match.reachability === "definite" || match.reachability === "possible",
        )
      ) {
        continue;
      }

      const definitionIds = definitions.map((definition) => definition.id);
      const stylesheetIds = [
        ...new Set(definitions.map((definition) => definition.stylesheetId)),
      ].sort((left, right) => left.localeCompare(right));

      findings.push({
        id: `css-class-unreachable:${reference.id}:${className}`,
        ruleId: "css-class-unreachable",
        confidence: "high",
        message: `Class "${className}" is defined, but every matching stylesheet is unreachable from this reference.`,
        subject: {
          kind: "class-reference",
          id: reference.id,
        },
        location: reference.location,
        evidence: [
          {
            kind: "source-file",
            id: reference.sourceFileId,
          },
          ...stylesheetIds.map((stylesheetId) => ({
            kind: "stylesheet" as const,
            id: stylesheetId,
          })),
        ],
        traces:
          context.includeTraces === false
            ? []
            : buildUnreachableClassTraces({
                reference,
                className,
                matches,
                stylesheetFilePaths: stylesheetIds
                  .map(
                    (stylesheetId) =>
                      getStylesheetById(context.analysisEvidence, stylesheetId)?.filePath,
                  )
                  .filter((filePath): filePath is string => Boolean(filePath)),
              }),
        data: {
          className,
          rawExpressionText: reference.rawExpressionText,
          expressionKind: reference.expressionKind,
          definitionIds,
          stylesheetIds,
          focusFilePaths: collectReferenceFocusFilePaths(context, className, reference),
        },
      });
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function collectReferenceFocusFilePaths(
  context: RuleContext,
  className: string,
  reference: ClassReferenceAnalysis,
): string[] {
  const componentId = reference.classNameComponentIds?.[className] ?? reference.componentId;
  const component = componentId
    ? getComponentById(context.analysisEvidence, componentId)
    : undefined;
  return [component?.filePath ?? reference.location.filePath];
}

function buildUnreachableClassTraces(input: {
  reference: ClassReferenceAnalysis;
  className: string;
  matches: ClassReferenceMatchRelation[];
  stylesheetFilePaths: string[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:css-class-unreachable:${input.reference.id}:${input.className}`,
      category: "rule-evaluation",
      summary: `class "${input.className}" was found, but every matching definition is in an unreachable stylesheet`,
      anchor: input.reference.location,
      children: [
        ...input.reference.traces,
        ...input.matches.flatMap((match) => match.traces),
        {
          traceId: `rule-evaluation:css-class-unreachable:${input.reference.id}:${input.className}:reachability-check`,
          category: "rule-evaluation",
          summary: `all matching class definitions for "${input.className}" had unavailable stylesheet reachability`,
          anchor: input.reference.location,
          children: [],
          metadata: {
            className: input.className,
            stylesheetFilePaths: input.stylesheetFilePaths,
          },
        },
      ],
      metadata: {
        ruleId: "css-class-unreachable",
        className: input.className,
        referenceId: input.reference.id,
        sourceFileId: input.reference.sourceFileId,
        rawExpressionText: input.reference.rawExpressionText,
      },
    },
  ];
}
