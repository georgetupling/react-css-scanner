import { buildFactGraphIndexes } from "./indexes.js";
import {
  fileResourceNodeId,
  containsEdgeId,
  definesSelectorEdgeId,
  moduleNodeId,
  originatesFromFileEdgeId,
  ruleDefinitionNodeId,
  selectorBranchNodeId,
  selectorNodeId,
  stylesheetNodeId,
} from "./ids.js";
import {
  factGraphProvenance,
  frontendFileProvenance,
  workspaceFileProvenance,
} from "./provenance.js";
import type {
  FactEdge,
  FactGraphInput,
  FactGraphResult,
  FactNode,
  FileResourceNode,
  ContainsEdge,
  DefinesSelectorEdge,
  ContainsEdgeContainmentKind,
  ModuleNode,
  OriginatesFromFileEdge,
  RuleDefinitionNode,
  SelectorBranchNode,
  SelectorNode,
  StyleSheetNode,
} from "./types.js";

export function buildFactGraph(input: FactGraphInput): FactGraphResult {
  const fileNodes = buildFileNodes(input);
  const moduleNodes = buildModuleNodes(input);
  const stylesheetNodes = buildStylesheetNodes(input);
  const cssNodes = buildCssNodes(input);
  const nodes = sortNodes([...fileNodes, ...moduleNodes, ...stylesheetNodes, ...cssNodes.all]);
  const originatesFromFileEdges = buildOriginatesFromFileEdges({
    fileNodes,
    moduleNodes,
    stylesheetNodes,
  });
  const cssEdges = buildCssEdges(cssNodes);
  const edges = sortEdges([...originatesFromFileEdges, ...cssEdges.all]);
  const { indexes, diagnostics } = buildFactGraphIndexes({ nodes, edges });

  return {
    snapshot: input.snapshot,
    frontends: input.frontends,
    graph: {
      meta: {
        rootDir: input.snapshot.rootDir,
        sourceFileCount: input.snapshot.files.sourceFiles.length,
        stylesheetCount: input.snapshot.files.stylesheets.length,
        htmlFileCount: input.snapshot.files.htmlFiles.length,
        generatedAtStage: "fact-graph",
      },
      nodes: {
        all: nodes,
        modules: moduleNodes,
        components: [],
        renderSites: [],
        elementTemplates: [],
        classExpressionSites: [],
        stylesheets: stylesheetNodes,
        ruleDefinitions: cssNodes.ruleDefinitions,
        selectors: cssNodes.selectors,
        selectorBranches: cssNodes.selectorBranches,
        ownerCandidates: [],
        files: fileNodes,
        externalResources: [],
      },
      edges: {
        all: edges,
        imports: [],
        renders: [],
        contains: cssEdges.contains,
        referencesClassExpression: [],
        definesSelector: cssEdges.definesSelector,
        originatesFromFile: originatesFromFileEdges,
        belongsToOwnerCandidate: [],
      },
      indexes,
      diagnostics,
    },
  };
}

function buildCssNodes(input: FactGraphInput): {
  all: Array<RuleDefinitionNode | SelectorNode | SelectorBranchNode>;
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
} {
  const ruleDefinitions: RuleDefinitionNode[] = [];
  const selectors: SelectorNode[] = [];
  const selectorBranches: SelectorBranchNode[] = [];

  for (const cssFile of [...input.frontends.css.files].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    const stylesheetId = stylesheetNodeId(cssFile.filePath);

    cssFile.rules.forEach((rule, ruleIndex) => {
      const ruleId = ruleDefinitionNodeId(stylesheetId, ruleIndex);
      const selectorId = selectorNodeId(stylesheetId, ruleIndex);
      const declarationProperties = [
        ...new Set(rule.declarations.map((declaration) => declaration.property)),
      ].sort((left, right) => left.localeCompare(right));
      const selectorEntries = cssFile.selectorEntries.filter(
        (entry) =>
          entry.source.kind === "css-source" &&
          entry.source.ruleKey === rule.selectorEntries[0]?.ruleKey,
      );

      ruleDefinitions.push({
        id: ruleId,
        kind: "rule-definition",
        stylesheetNodeId: stylesheetId,
        filePath: cssFile.filePath,
        selectorText: rule.selector,
        declarationProperties,
        declarationSignature: rule.declarations
          .map((declaration) => `${declaration.property}:${declaration.value}`)
          .join(";"),
        line: rule.line,
        atRuleContext: [...rule.atRuleContext],
        location: rule.selectorEntries[0]?.selectorAnchor,
        sourceRule: rule,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: cssFile.filePath,
          summary: "Extracted CSS rule frontend fact",
        }),
      });
      selectors.push({
        id: selectorId,
        kind: "selector",
        stylesheetNodeId: stylesheetId,
        ruleDefinitionNodeId: ruleId,
        selectorText: rule.selector,
        selectorListText: rule.selector,
        sourceKind: "css-rule",
        location: rule.selectorEntries[0]?.selectorAnchor,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: cssFile.filePath,
          summary: "Extracted CSS selector frontend fact",
        }),
      });

      for (const entry of selectorEntries) {
        if (entry.source.kind !== "css-source" || entry.source.branchIndex === undefined) {
          continue;
        }

        const branchFact = rule.selectorBranches[entry.source.branchIndex];
        if (!branchFact) {
          continue;
        }

        selectorBranches.push({
          id: selectorBranchNodeId(stylesheetId, ruleIndex, entry.source.branchIndex),
          kind: "selector-branch",
          selectorNodeId: selectorId,
          stylesheetNodeId: stylesheetId,
          ruleDefinitionNodeId: ruleId,
          selectorText: entry.selectorText,
          selectorListText: entry.source.selectorListText ?? rule.selector,
          branchIndex: entry.source.branchIndex,
          branchCount: entry.source.branchCount ?? rule.selectorBranches.length,
          ruleKey: entry.source.ruleKey ?? `${cssFile.filePath}:${ruleIndex}:${rule.selector}`,
          requiredClassNames: [...branchFact.requiredClassNames],
          subjectClassNames: [...branchFact.subjectClassNames],
          contextClassNames: [...branchFact.contextClassNames],
          negativeClassNames: [...branchFact.negativeClassNames],
          matchKind: branchFact.matchKind,
          hasUnknownSemantics: branchFact.hasUnknownSemantics,
          atRuleContext: entry.source.atRuleContext ?? [],
          location: entry.source.selectorAnchor,
          sourceQuery: entry,
          confidence: branchFact.hasUnknownSemantics ? "medium" : "high",
          provenance: frontendFileProvenance({
            filePath: cssFile.filePath,
            summary: "Extracted CSS selector branch frontend fact",
          }),
        });
      }
    });
  }

  return {
    all: sortNodes([...ruleDefinitions, ...selectors, ...selectorBranches]),
    ruleDefinitions: sortNodes(ruleDefinitions),
    selectors: sortNodes(selectors),
    selectorBranches: sortNodes(selectorBranches),
  };
}

function buildCssEdges(input: {
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
}): {
  all: Array<ContainsEdge | DefinesSelectorEdge>;
  contains: ContainsEdge[];
  definesSelector: DefinesSelectorEdge[];
} {
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

function buildFileNodes(input: FactGraphInput): FileResourceNode[] {
  const sourceFileNodes = input.snapshot.files.sourceFiles.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "source",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered source file",
      }),
    }),
  );
  const stylesheetFileNodes = input.snapshot.files.stylesheets.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "stylesheet",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered stylesheet file",
      }),
    }),
  );
  const htmlFileNodes = input.snapshot.files.htmlFiles.map(
    (file): FileResourceNode => ({
      id: fileResourceNodeId(file.filePath),
      kind: "file-resource",
      filePath: file.filePath,
      absolutePath: file.absolutePath,
      fileKind: "html",
      confidence: "high",
      provenance: workspaceFileProvenance({
        filePath: file.filePath,
        summary: "Discovered HTML file",
      }),
    }),
  );
  const configFileNodes = input.snapshot.files.configFiles
    .filter((file): file is typeof file & { filePath: string } => Boolean(file.filePath))
    .map(
      (file): FileResourceNode => ({
        id: fileResourceNodeId(file.filePath),
        kind: "file-resource",
        filePath: file.filePath,
        fileKind: "config",
        confidence: "high",
        provenance: workspaceFileProvenance({
          filePath: file.filePath,
          summary: "Loaded config file",
        }),
      }),
    );

  return sortNodes([
    ...sourceFileNodes,
    ...stylesheetFileNodes,
    ...htmlFileNodes,
    ...configFileNodes,
  ]) as FileResourceNode[];
}

function buildModuleNodes(input: FactGraphInput): ModuleNode[] {
  return sortNodes(
    input.frontends.source.files.map(
      (file): ModuleNode => ({
        id: moduleNodeId(file.filePath),
        kind: "module",
        filePath: file.filePath,
        absolutePath: file.absolutePath,
        moduleKind: "source",
        languageKind: file.languageKind,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: file.filePath,
          summary: "Extracted source module frontend facts",
        }),
      }),
    ),
  ) as ModuleNode[];
}

function buildStylesheetNodes(input: FactGraphInput): StyleSheetNode[] {
  return sortNodes(
    input.frontends.css.files.map(
      (file): StyleSheetNode => ({
        id: stylesheetNodeId(file.filePath),
        kind: "stylesheet",
        filePath: file.filePath,
        absolutePath: file.absolutePath,
        cssKind: file.cssKind,
        origin: file.origin,
        confidence: "high",
        provenance: frontendFileProvenance({
          filePath: file.filePath,
          summary: "Extracted stylesheet frontend facts",
        }),
      }),
    ),
  ) as StyleSheetNode[];
}

function buildOriginatesFromFileEdges(input: {
  fileNodes: FileResourceNode[];
  moduleNodes: ModuleNode[];
  stylesheetNodes: StyleSheetNode[];
}): OriginatesFromFileEdge[] {
  const fileNodeIdsByPath = new Map(input.fileNodes.map((node) => [node.filePath, node.id]));
  const moduleEdges = input.moduleNodes.flatMap((node): OriginatesFromFileEdge[] => {
    const fileNodeId = fileNodeIdsByPath.get(node.filePath);
    if (!fileNodeId) {
      return [];
    }

    return [buildOriginatesFromFileEdge(node.id, fileNodeId)];
  });
  const stylesheetEdges = input.stylesheetNodes.flatMap((node): OriginatesFromFileEdge[] => {
    if (!node.filePath || node.origin === "remote") {
      return [];
    }

    const fileNodeId = fileNodeIdsByPath.get(node.filePath);
    if (!fileNodeId) {
      return [];
    }

    return [buildOriginatesFromFileEdge(node.id, fileNodeId)];
  });

  return [...moduleEdges, ...stylesheetEdges];
}

function buildOriginatesFromFileEdge(from: string, to: string): OriginatesFromFileEdge {
  return {
    id: originatesFromFileEdgeId(from, to),
    kind: "originates-from-file",
    from,
    to,
    confidence: "high",
    provenance: factGraphProvenance("Linked graph node to originating file resource"),
  };
}

function buildContainsEdge(
  from: string,
  to: string,
  containmentKind: ContainsEdgeContainmentKind,
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

function sortNodes<T extends FactNode>(nodes: T[]): T[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortEdges<T extends FactEdge>(edges: T[]): T[] {
  return [...edges].sort((left, right) => left.id.localeCompare(right.id));
}
