import type {
  ContainsEdge,
  DefinesSelectorEdge,
  RuleDefinitionNode,
  SelectorBranchNode,
  SelectorNode,
} from "../types.js";
import { containsEdgeId, definesSelectorEdgeId } from "../ids.js";
import { factGraphProvenance } from "../provenance.js";
import { sortEdges } from "../utils/sortGraphElements.js";

export type BuiltCssEdges = {
  all: Array<ContainsEdge | DefinesSelectorEdge>;
  contains: ContainsEdge[];
  definesSelector: DefinesSelectorEdge[];
};

export function buildCssEdges(input: {
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
}): BuiltCssEdges {
  const contains: ContainsEdge[] = [];
  const definesSelector: DefinesSelectorEdge[] = [];

  for (const rule of input.ruleDefinitions) {
    contains.push(buildContainsEdge(rule.stylesheetNodeId, rule.id, "stylesheet-rule"));
  }

  for (const selector of input.selectors) {
    if (selector.ruleDefinitionNodeId) {
      contains.push(buildContainsEdge(selector.ruleDefinitionNodeId, selector.id, "rule-selector"));
      definesSelector.push(buildDefinesSelectorEdge(selector.ruleDefinitionNodeId, selector.id));
    }

    if (selector.stylesheetNodeId) {
      definesSelector.push(buildDefinesSelectorEdge(selector.stylesheetNodeId, selector.id));
    }
  }

  for (const branch of input.selectorBranches) {
    contains.push(buildContainsEdge(branch.selectorNodeId, branch.id, "selector-branch"));

    if (branch.ruleDefinitionNodeId) {
      definesSelector.push(buildDefinesSelectorEdge(branch.ruleDefinitionNodeId, branch.id));
    }
  }

  return {
    all: sortEdges([...contains, ...definesSelector]),
    contains: sortEdges(contains),
    definesSelector: sortEdges(definesSelector),
  };
}

function buildContainsEdge(
  from: string,
  to: string,
  containmentKind: ContainsEdge["containmentKind"],
): ContainsEdge {
  return {
    id: containsEdgeId(from, to),
    kind: "contains",
    from,
    to,
    containmentKind,
    confidence: "high",
    provenance: factGraphProvenance("Linked contained stylesheet graph facts"),
  };
}

function buildDefinesSelectorEdge(from: string, to: string): DefinesSelectorEdge {
  return {
    id: definesSelectorEdgeId(from, to),
    kind: "defines-selector",
    from,
    to,
    confidence: "high",
    provenance: factGraphProvenance("Linked selector definition graph facts"),
  };
}
