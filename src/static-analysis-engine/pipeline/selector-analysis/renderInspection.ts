import type { RenderElementNode, RenderNode } from "../render-model/render-ir/types.js";

export type InspectionEvaluation = "match" | "possible-match" | "unsupported" | "no-match";

export type RenderInspectionHelpers<TState> = {
  inspectNode: (node: RenderNode, state: TState) => InspectionEvaluation;
  inspectChildren: (children: RenderNode[], state: TState) => InspectionEvaluation;
  inspectDirectChildren: (
    children: RenderNode[],
    inspectDirectChild: (node: RenderNode) => InspectionEvaluation,
  ) => InspectionEvaluation;
  mergeEvaluations: (evaluations: InspectionEvaluation[]) => InspectionEvaluation;
  mergeBranches: (left: InspectionEvaluation, right: InspectionEvaluation) => InspectionEvaluation;
};

export type RenderNodeInspectionAdapter<TState> = {
  inspectElement: (input: {
    node: RenderElementNode;
    state: TState;
    helpers: RenderInspectionHelpers<TState>;
  }) => InspectionEvaluation;
};

export function inspectRenderNode<TState>(input: {
  node: RenderNode;
  state: TState;
  adapter: RenderNodeInspectionAdapter<TState>;
}): InspectionEvaluation {
  const helpers: RenderInspectionHelpers<TState> = {
    inspectNode(node, state) {
      return inspectRenderNode({
        node,
        state,
        adapter: input.adapter,
      });
    },
    inspectChildren(children, state) {
      return mergeInspectionEvaluations(
        children.map((child) =>
          inspectRenderNode({
            node: child,
            state,
            adapter: input.adapter,
          }),
        ),
      );
    },
    inspectDirectChildren(children, inspectDirectChild) {
      return mergeInspectionEvaluations(
        flattenDirectChildCandidates(children).map((child) => inspectDirectChild(child)),
      );
    },
    mergeEvaluations: mergeInspectionEvaluations,
    mergeBranches: mergeBranchEvaluations,
  };

  if (input.node.kind === "conditional") {
    return mergeBranchEvaluations(
      inspectRenderNode({
        node: input.node.whenTrue,
        state: input.state,
        adapter: input.adapter,
      }),
      inspectRenderNode({
        node: input.node.whenFalse,
        state: input.state,
        adapter: input.adapter,
      }),
    );
  }

  if (input.node.kind === "fragment") {
    return mergeInspectionEvaluations(
      input.node.children.map((child) =>
        inspectRenderNode({
          node: child,
          state: input.state,
          adapter: input.adapter,
        }),
      ),
    );
  }

  if (input.node.kind === "repeated-region") {
    const templateEvaluation = inspectRenderNode({
      node: input.node.template,
      state: input.state,
      adapter: input.adapter,
    });
    return templateEvaluation === "match" ? "possible-match" : templateEvaluation;
  }

  if (input.node.kind !== "element") {
    return "no-match";
  }

  return input.adapter.inspectElement({
    node: input.node,
    state: input.state,
    helpers,
  });
}

function flattenDirectChildCandidates(children: RenderNode[]): RenderNode[] {
  const directChildren: RenderNode[] = [];

  for (const child of children) {
    if (child.kind === "fragment") {
      directChildren.push(...flattenDirectChildCandidates(child.children));
      continue;
    }

    if (child.kind === "repeated-region") {
      directChildren.push(child);
      continue;
    }

    directChildren.push(child);
  }

  return directChildren;
}

export function mergeInspectionEvaluations(
  evaluations: InspectionEvaluation[],
): InspectionEvaluation {
  if (evaluations.includes("match")) {
    return "match";
  }

  if (evaluations.includes("possible-match")) {
    return "possible-match";
  }

  if (evaluations.includes("unsupported")) {
    return "unsupported";
  }

  return "no-match";
}

export function mergeBranchEvaluations(
  left: InspectionEvaluation,
  right: InspectionEvaluation,
): InspectionEvaluation {
  if (left === "match" || right === "match") {
    if (left === "match" && right === "match") {
      return "match";
    }

    return "possible-match";
  }

  if (left === "possible-match" || right === "possible-match") {
    return "possible-match";
  }

  if (left === "unsupported" || right === "unsupported") {
    return "unsupported";
  }

  return "no-match";
}
