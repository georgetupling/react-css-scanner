import type { ExpressionSyntaxNode } from "../../fact-graph/index.js";
import type { ProjectEvidenceBuildInput } from "../analysisTypes.js";
import { uniqueSorted } from "../internal/shared.js";

export function resolveCssModuleExpressionReferences(input: {
  expressionNode: ExpressionSyntaxNode;
  factGraph?: NonNullable<ProjectEvidenceBuildInput["factGraph"]>["graph"];
}): Array<{
  localName: string;
  memberName: string;
  accessKind: "property" | "string-literal-element";
}> {
  const expressionNode = input.expressionNode;
  const nodesById = input.factGraph?.indexes.nodesById;
  if (!nodesById) {
    return [];
  }

  if (expressionNode.expressionKind === "member-access" && expressionNode.propertyName) {
    const objectNodeId = expressionNode.objectExpressionId
      ? input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
          expressionNode.objectExpressionId,
        )
      : undefined;
    const objectNode = objectNodeId ? nodesById.get(objectNodeId) : undefined;
    if (
      !objectNode ||
      objectNode.kind !== "expression-syntax" ||
      objectNode.expressionKind !== "identifier"
    ) {
      return [];
    }
    return [
      {
        localName: objectNode.name,
        memberName: expressionNode.propertyName,
        accessKind: "property",
      },
    ];
  }

  if (expressionNode.expressionKind === "element-access" && expressionNode.argumentExpressionId) {
    const objectNodeId = expressionNode.objectExpressionId
      ? input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
          expressionNode.objectExpressionId,
        )
      : undefined;
    const objectNode = objectNodeId ? nodesById.get(objectNodeId) : undefined;
    const argumentNodeId = input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
      expressionNode.argumentExpressionId,
    );
    const argumentNode = argumentNodeId ? nodesById.get(argumentNodeId) : undefined;
    if (
      !objectNode ||
      objectNode.kind !== "expression-syntax" ||
      objectNode.expressionKind !== "identifier" ||
      !argumentNode ||
      argumentNode.kind !== "expression-syntax"
    ) {
      return [];
    }
    const memberNames = getStringCandidatesFromExpressionNode(argumentNode, input.factGraph);
    if (memberNames.length === 0) {
      return [];
    }
    return memberNames.map((memberName) => ({
      localName: objectNode.name,
      memberName,
      accessKind: "string-literal-element" as const,
    }));
  }

  return [];
}

function getStringCandidatesFromExpressionNode(
  expressionNode: ReturnType<
    NonNullable<ProjectEvidenceBuildInput["factGraph"]>["graph"]["indexes"]["nodesById"]["get"]
  >,
  factGraph: NonNullable<ProjectEvidenceBuildInput["factGraph"]>["graph"] | undefined,
): string[] {
  if (!expressionNode || expressionNode.kind !== "expression-syntax") {
    return [];
  }

  if (expressionNode.expressionKind === "string-literal") {
    return [expressionNode.value];
  }

  if (expressionNode.expressionKind === "identifier") {
    return [...(expressionNode.possibleStringValues ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  if (expressionNode.expressionKind !== "template-literal") {
    return [];
  }

  let candidates = [expressionNode.headText];
  for (const span of expressionNode.spans) {
    const spanNodeId = factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
      span.expressionId,
    );
    const spanNode = spanNodeId ? factGraph?.indexes.nodesById.get(spanNodeId) : undefined;
    const spanCandidates = getStringCandidatesFromExpressionNode(spanNode, factGraph);
    if (spanCandidates.length === 0) {
      return [];
    }
    candidates = candidates.flatMap((prefix) =>
      spanCandidates.map((candidate) => `${prefix}${candidate}${span.literalText}`),
    );
    if (candidates.length > 32) {
      return [];
    }
  }

  return uniqueSorted(candidates);
}
