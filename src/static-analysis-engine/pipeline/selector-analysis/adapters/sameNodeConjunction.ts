import type { RenderNode } from "../../render-model/render-ir/types.js";
import type { ClassExpressionSummary } from "../../symbolic-evaluation/class-values/types.js";
import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorQueryResult,
  SelectorSymbolicClassExpressionIndex,
} from "../types.js";
import { buildSelectorQueryResult } from "../resultUtils.js";
import { mergeBranchEvaluations, mergeInspectionEvaluations } from "../renderInspection.js";
import { attachMatchedReachability } from "../reachabilityResultUtils.js";
import { evaluateClassRequirement } from "../selectorEvaluationUtils.js";

type SameNodeConstraint = Extract<
  ParsedSelectorQuery["constraint"],
  { kind: "same-node-class-conjunction" }
>;

export function analyzeSameNodeClassConjunction(input: {
  selectorQuery: ParsedSelectorQuery;
  constraint: SameNodeConstraint;
  analysisTargets: SelectorAnalysisTarget[];
  symbolicClassExpressions?: SelectorSymbolicClassExpressionIndex;
  includeTraces?: boolean;
}): SelectorQueryResult {
  const includeTraces = input.includeTraces ?? true;
  let sawUnsupportedDynamicClass = false;
  let sawPossibleMatch = false;
  const matchedTargets: SelectorAnalysisTarget[] = [];

  for (const analysisTarget of input.analysisTargets) {
    const evaluation = inspectNodeForSameNodeConstraint(
      analysisTarget.renderSubtree.root,
      input.constraint.classNames,
      input.symbolicClassExpressions,
    );
    if (evaluation === "match") {
      if (analysisTarget.reachabilityAvailability === "possible") {
        sawPossibleMatch = true;
        matchedTargets.push(analysisTarget);
        continue;
      }

      return attachMatchedReachability({
        selectorQuery: input.selectorQuery,
        matchedTargets: [analysisTarget],
        result: buildSelectorQueryResult({
          selectorQuery: input.selectorQuery,
          outcome: "match",
          status: "resolved",
          reasons: [
            `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
          ],
          certainty: "definite",
          dimensions: { structure: "definite" },
          traces: includeTraces
            ? [
                {
                  traceId: "selector-match:same-node:definite",
                  category: "selector-match",
                  summary: `found a rendered element with all required classes: ${input.constraint.classNames.join(", ")}`,
                  anchor:
                    input.selectorQuery.source.kind === "css-source"
                      ? input.selectorQuery.source.selectorAnchor
                      : undefined,
                  children: [],
                },
              ]
            : [],
          includeTraces,
        }),
        includeTraces,
      });
    }

    if (evaluation === "possible-match") {
      sawPossibleMatch = true;
      matchedTargets.push(analysisTarget);
    }

    if (evaluation === "unsupported") {
      sawUnsupportedDynamicClass = true;
    }
  }

  if (sawPossibleMatch) {
    return attachMatchedReachability({
      selectorQuery: input.selectorQuery,
      matchedTargets,
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "possible-match",
        status: "resolved",
        reasons: [
          `at least one rendered element may emit all required classes together: ${input.constraint.classNames.join(", ")}`,
        ],
        certainty: "possible",
        dimensions: { structure: "possible" },
        traces: includeTraces
          ? [
              {
                traceId: "selector-match:same-node:possible",
                category: "selector-match",
                summary: `at least one rendered element may emit all required classes together: ${input.constraint.classNames.join(", ")}`,
                anchor:
                  input.selectorQuery.source.kind === "css-source"
                    ? input.selectorQuery.source.selectorAnchor
                    : undefined,
                children: [],
              },
            ]
          : [],
        includeTraces,
      }),
      includeTraces,
    });
  }

  if (sawUnsupportedDynamicClass) {
    return buildSelectorQueryResult({
      selectorQuery: input.selectorQuery,
      outcome: "possible-match",
      status: "unsupported",
      reasons: [
        "encountered unsupported dynamic class construction while checking same-node class conjunction",
      ],
      certainty: "unknown",
      dimensions: { structure: "unsupported" },
      traces: includeTraces
        ? [
            {
              traceId: "selector-match:same-node:unsupported",
              category: "selector-match",
              summary:
                "encountered unsupported dynamic class construction while checking same-node class conjunction",
              anchor:
                input.selectorQuery.source.kind === "css-source"
                  ? input.selectorQuery.source.selectorAnchor
                  : undefined,
              children: [],
            },
          ]
        : [],
      includeTraces,
    });
  }

  return buildSelectorQueryResult({
    selectorQuery: input.selectorQuery,
    outcome: "no-match-under-bounded-analysis",
    status: "resolved",
    reasons: [
      `no rendered element emitted all required classes together: ${input.constraint.classNames.join(", ")}`,
    ],
    certainty: "definite",
    dimensions: { structure: "not-found-under-bounded-analysis" },
    traces: includeTraces
      ? [
          {
            traceId: "selector-match:same-node:no-match",
            category: "selector-match",
            summary: `no rendered element emitted all required classes together: ${input.constraint.classNames.join(", ")}`,
            anchor:
              input.selectorQuery.source.kind === "css-source"
                ? input.selectorQuery.source.selectorAnchor
                : undefined,
            children: [],
          },
        ]
      : [],
    includeTraces,
  });
}

function inspectNodeForSameNodeConstraint(
  node: RenderNode,
  classNames: string[],
  symbolicClassExpressions: SelectorSymbolicClassExpressionIndex | undefined,
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (node.kind === "element") {
    const evaluation =
      evaluateSymbolicClassRequirement(symbolicClassExpressions, node.className, classNames) ??
      evaluateClassRequirement(node.className, classNames);
    if (evaluation !== "no-match") {
      return evaluation;
    }
  }

  if (node.kind === "conditional") {
    const whenTrue = inspectNodeForSameNodeConstraint(
      node.whenTrue,
      classNames,
      symbolicClassExpressions,
    );
    const whenFalse = inspectNodeForSameNodeConstraint(
      node.whenFalse,
      classNames,
      symbolicClassExpressions,
    );
    return mergeBranchEvaluations(whenTrue, whenFalse);
  }

  if (node.kind === "repeated-region") {
    const evaluation = inspectNodeForSameNodeConstraint(
      node.template,
      classNames,
      symbolicClassExpressions,
    );
    return evaluation === "match" ? "possible-match" : evaluation;
  }

  if (node.kind === "fragment") {
    return mergeInspectionEvaluations(
      node.children.map((child) =>
        inspectNodeForSameNodeConstraint(child, classNames, symbolicClassExpressions),
      ),
    );
  }

  if (node.kind === "element") {
    return mergeInspectionEvaluations(
      node.children.map((child) =>
        inspectNodeForSameNodeConstraint(child, classNames, symbolicClassExpressions),
      ),
    );
  }

  return "no-match";
}

function evaluateSymbolicClassRequirement(
  symbolicClassExpressions: SelectorSymbolicClassExpressionIndex | undefined,
  className: ClassExpressionSummary | undefined,
  requiredClassNames: string[],
): "match" | "possible-match" | "unsupported" | "no-match" | undefined {
  if (!symbolicClassExpressions || !className) {
    return undefined;
  }

  const expression = symbolicClassExpressions.classExpressionByAnchorKey.get(
    createClassExpressionAnchorKey(className),
  );
  if (!expression) {
    return undefined;
  }

  if (
    expression.emissionVariants.some((variant) => includesAll(variant.tokens, requiredClassNames))
  ) {
    return "match";
  }

  if (
    expression.emissionVariants.length > 0 &&
    expression.emissionVariants.every(
      (variant) => variant.completeness === "complete" && !variant.unknownDynamic,
    )
  ) {
    return "no-match";
  }

  const emittedTokens = expression.tokens.filter(
    (token) => token.tokenKind !== "css-module-export",
  );
  const allPresent = requiredClassNames.every((className) =>
    emittedTokens.some((token) => token.token === className),
  );
  if (allPresent) {
    return "possible-match";
  }

  if (expression.certainty.kind === "unknown" || expression.certainty.kind === "partial") {
    return "unsupported";
  }

  return "no-match";
}

function includesAll(tokens: string[], requiredClassNames: string[]): boolean {
  return requiredClassNames.every((className) => tokens.includes(className));
}

function createClassExpressionAnchorKey(className: ClassExpressionSummary): string {
  const anchor = className.sourceAnchor;
  return [
    anchor.filePath.replace(/\\/g, "/"),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}
