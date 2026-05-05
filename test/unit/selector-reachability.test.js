import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactGraph,
  buildLanguageFrontends,
  buildRenderStructure,
  buildSelectorReachability,
  evaluateSymbolicExpressions,
} from "../../dist/static-analysis-engine.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("selector reachability returns empty facts when no selector branches exist", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: 'export function App() { return <div className="button" />; }\n',
    cssText: "",
  });

  const result = buildSelectorReachability(renderStructure);

  assert.deepEqual(result.meta, {
    generatedAtStage: "selector-reachability",
    selectorBranchCount: 0,
    selectorQueryCount: 0,
    elementMatchCount: 0,
    branchMatchCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.selectorBranches, []);
  assert.deepEqual(result.selectorQueries, []);
  assert.deepEqual(result.elementMatches, []);
  assert.deepEqual(result.branchMatches, []);
  assert.deepEqual(result.diagnostics, []);
});

test("selector reachability output is deterministic across repeated runs", async () => {
  const firstRenderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App({ active }) { return <button className={active ? "button primary" : "button secondary"} />; }\n',
    cssText: ".button.primary, .button.secondary { color: blue; }\n",
  });
  const secondRenderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App({ active }) { return <button className={active ? "button primary" : "button secondary"} />; }\n',
    cssText: ".button.primary, .button.secondary { color: blue; }\n",
  });

  assert.deepEqual(
    serializeSelectorReachability(buildSelectorReachability(firstRenderStructure)),
    serializeSelectorReachability(buildSelectorReachability(secondRenderStructure)),
  );
});

test("selector reachability query output is deterministic across repeated runs", async () => {
  const firstRenderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App({ active }) { return <button className={active ? "button primary" : "button secondary"} />; }\n',
    cssText: ".button.primary, .button.secondary { color: blue; }\n",
  });
  const secondRenderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App({ active }) { return <button className={active ? "button primary" : "button secondary"} />; }\n',
    cssText: ".button.primary, .button.secondary { color: blue; }\n",
  });
  const first = buildSelectorReachability(firstRenderStructure);
  const second = buildSelectorReachability(secondRenderStructure);

  assert.deepEqual(first.selectorQueries, second.selectorQueries);
});

test("selector reachability exposes branch and query reasons", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: [
      'import "./app.css";',
      'export function App() { return <main><button className="button button--primary" /></main>; }',
      "",
    ].join("\n"),
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = result.selectorBranches.find(
    (candidate) => candidate.branchText === ".button.button--primary",
  );
  assert.ok(branch);
  assert.equal(branch.status, "definitely-matchable");
  assert.deepEqual(branch.reasons, ["a bounded selector match was found"]);

  const query = result.selectorQueries.find(
    (candidate) => candidate.selectorNodeId === branch.selectorNodeId,
  );
  assert.ok(query);
  assert.deepEqual(query.reasons, ["a bounded selector match was found"]);
});

test("selector reachability matches same-element compound class selectors", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: 'export function App() { return <button className="button button--primary" />; }\n',
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button.button--primary");

  assert.equal(branch.status, "definitely-matchable");
  assert.deepEqual(branch.requirement, {
    kind: "same-node-class-conjunction",
    classNames: ["button", "button--primary"],
    normalizedSteps: [
      { combinatorFromPrevious: null, requiredClasses: ["button"] },
      { combinatorFromPrevious: "same-node", requiredClasses: ["button--primary"] },
    ],
    parseNotes: [
      "normalized selector into a same-node class conjunction",
      "required classes: button, button--primary",
    ],
    traces: [],
  });
  assert.equal(branch.matchIds.length, 1);

  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);
  assert.deepEqual(match.requiredClassNames, ["button", "button--primary"]);
  assert.equal(match.certainty, "definite");
});

test("selector reachability indexes render elements, emissions, paths, and match evidence", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: 'export function App() { return <button className="button button--primary" />; }\n',
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button.button--primary");
  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);

  const subjectElement = result.indexes.renderElementById.get(match.subjectElementId);
  assert.ok(subjectElement);
  assert.equal(subjectElement.tagName, "button");
  assert.deepEqual(result.indexes.matchIdsByElementId.get(subjectElement.id), [match.id]);
  assert.ok(
    result.indexes.renderPathIdsByElementId
      .get(subjectElement.id)
      ?.includes(subjectElement.renderPathId),
  );

  for (const emissionSiteId of match.supportingEmissionSiteIds) {
    const emissionSite = result.indexes.emissionSiteById.get(emissionSiteId);
    assert.ok(emissionSite);
    assert.equal(emissionSite.elementId, subjectElement.id);
    assert.ok(
      result.indexes.emissionSiteIdsByElementId.get(subjectElement.id)?.includes(emissionSiteId),
    );
    assert.ok(
      result.indexes.renderPathIdsByEmissionSiteId
        .get(emissionSiteId)
        ?.includes(emissionSite.renderPathId),
    );
    assert.ok(result.indexes.matchIdsByEmissionSiteId.get(emissionSiteId)?.includes(match.id));
  }

  for (const renderPathId of match.renderPathIds) {
    assert.ok(result.indexes.renderPathById.get(renderPathId));
    assert.ok(result.indexes.matchIdsByRenderPathId.get(renderPathId)?.includes(match.id));
  }
});

test("selector reachability indexes unknown class emissions and unknown render regions", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: [
      "export function App(props) {",
      '  return <main className={props.wrapperClass}><MissingWidget className="missing" /></main>;',
      "}",
      "",
    ].join("\n"),
    cssText: ".missing { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);

  assert.ok(result.indexes.unknownClassElementIds.length > 0);
  assert.ok(result.indexes.unknownClassEmissionSiteIds.length > 0);
  for (const elementId of result.indexes.unknownClassElementIds) {
    assert.ok(result.indexes.renderElementById.get(elementId));
    assert.ok(result.indexes.unknownClassEmissionSiteIdsByElementId.get(elementId)?.length);
  }

  assert.ok(result.indexes.unknownRegionById.size > 0);
  for (const region of result.indexes.unknownRegionById.values()) {
    assert.equal(region.regionKind, "unknown-barrier");
    assert.ok(
      result.indexes.unknownRegionIdsByRenderPathId.get(region.renderPathId)?.includes(region.id),
    );
  }
});

test("selector reachability does not match compound classes split across elements", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <div className="button"><span className="button--primary" /></div>; }\n',
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button.button--primary");

  assert.equal(branch.status, "not-matchable");
  assert.deepEqual(branch.matchIds, []);
});

test("selector reachability marks bounded class alternatives as possible matches", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App({ primary }) { return <button className={primary ? "button button--primary" : "button"} />; }\n',
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button.button--primary");

  assert.equal(branch.status, "possibly-matchable");
  assert.equal(branch.confidence, "medium");
  assert.equal(branch.matchIds.length, 1);

  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);
  assert.equal(match.certainty, "possible");
});

test("selector reachability respects mutually exclusive class variants", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: [
      "export function App({ primary }) {",
      '  return <button className={primary ? "button button--primary" : "button button--secondary"} />;',
      "}",
      "",
    ].join("\n"),
    cssText: ".button--primary.button--secondary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button--primary.button--secondary");

  assert.equal(branch.status, "not-matchable");
  assert.deepEqual(branch.matchIds, []);
});

test("selector reachability matches descendant selectors across nested elements", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <article className="card"><div><h2 className="title" /></div></article>; }\n',
    cssText: ".card .title { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".card .title");

  assert.equal(branch.status, "definitely-matchable");
  assert.equal(branch.requirement.kind, "ancestor-descendant");
  assert.deepEqual(branch.requirement.normalizedSteps, [
    { combinatorFromPrevious: null, requiredClasses: ["card"] },
    { combinatorFromPrevious: "descendant", requiredClasses: ["title"] },
  ]);
  assert.equal(branch.matchIds.length, 1);

  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);
  assert.deepEqual(match.requiredClassNames, ["card", "title"]);
  assert.equal(match.certainty, "definite");
});

test("selector reachability matches child selectors only across direct children", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <article className="card"><div><h2 className="title" /></div></article>; }\n',
    cssText: ".card > .title { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".card > .title");

  assert.equal(branch.status, "not-matchable");
  assert.deepEqual(branch.matchIds, []);
});

test("selector reachability matches adjacent sibling selectors by child order", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <div><span className="first" /><span className="second" /></div>; }\n',
    cssText: ".first + .second { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".first + .second");

  assert.equal(branch.status, "definitely-matchable");
  assert.equal(branch.matchIds.length, 1);
});

test("selector reachability matches general sibling selectors by later sibling order", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <div><span className="first" /><span /><span className="third" /></div>; }\n',
    cssText: ".first ~ .third { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".first ~ .third");

  assert.equal(branch.status, "definitely-matchable");
  assert.equal(branch.matchIds.length, 1);
});

test("selector reachability marks type-qualified selector branches unsupported", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: 'export function App() { return <h2 className="title" />; }\n',
    cssText: "h2.title { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, "h2.title");

  assert.equal(branch.status, "unsupported");
  assert.equal(branch.requirement.kind, "unsupported");
  assert.deepEqual(branch.matchIds, []);
  assert.equal(branch.diagnosticIds.length, 1);
});

test("selector reachability does not treat CSS Module exports as global class selector matches", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: [
      'import styles from "./App.module.css";',
      "export function App() {",
      "  return <button className={styles.button} />;",
      "}",
      "",
    ].join("\n"),
    cssFilePath: "src/App.module.css",
    cssText: ".button { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button");

  assert.notEqual(branch.status, "definitely-matchable");
  assert.notEqual(branch.status, "possibly-matchable");
  assert.deepEqual(branch.matchIds, []);
});

test("selector reachability preserves child emission provenance across component boundaries", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: [
      "function Child() {",
      '  return <h2 className="title" />;',
      "}",
      "export function App() {",
      '  return <article className="card"><Child /></article>;',
      "}",
      "",
    ].join("\n"),
    cssText: ".card .title { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".card .title");
  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);

  const childComponent = renderStructure.renderModel.components.find(
    (component) => component.componentName === "Child",
  );
  const appComponent = renderStructure.renderModel.components.find(
    (component) => component.componentName === "App",
  );
  assert.ok(childComponent?.componentNodeId);
  assert.ok(appComponent?.componentNodeId);

  const titleEmissionSite = match.supportingEmissionSiteIds
    .map((emissionSiteId) => result.indexes.emissionSiteById.get(emissionSiteId))
    .find((emissionSite) =>
      emissionSite?.tokens.some(
        (token) => token.token === "title" && token.tokenKind === "global-class",
      ),
    );
  assert.ok(titleEmissionSite);
  assert.equal(titleEmissionSite.emittingComponentNodeId, childComponent.componentNodeId);

  const subjectElement = result.indexes.renderElementById.get(match.subjectElementId);
  assert.ok(subjectElement);
  assert.equal(subjectElement.emittingComponentNodeId, childComponent.componentNodeId);
  assert.equal(subjectElement.placementComponentNodeId, appComponent.componentNodeId);
});

test("selector reachability marks multi-class structural sides unsupported", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText:
      'export function App() { return <article className="card highlighted"><h2 className="title" /></article>; }\n',
    cssText: ".card.highlighted > .title { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".card.highlighted > .title");

  assert.equal(branch.status, "unsupported");
  assert.deepEqual(branch.matchIds, []);
  assert.equal(branch.diagnosticIds.length, 1);
});

async function buildRenderStructureFixture(input) {
  const cssFilePath = input.cssFilePath ?? "src/app.css";
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", input.sourceText)
    .withCssFile(cssFilePath, input.cssText)
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: [cssFilePath],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const factGraph = buildFactGraph({ snapshot, frontends });
    const symbolicEvaluation = evaluateSymbolicExpressions({
      graph: factGraph.graph,
    });

    const renderStructure = buildRenderStructure({
      graph: factGraph.graph,
      symbolicEvaluation,
      options: {
        includeTraces: true,
      },
    });
    return {
      renderModel: renderStructure.renderModel,
      selectorBranches: factGraph.graph.nodes.selectorBranches,
    };
  } finally {
    await project.cleanup();
  }
}

function findBranch(result, selectorText) {
  const branch = result.selectorBranches.find((candidate) => candidate.branchText === selectorText);
  assert.ok(branch);
  return branch;
}

function serializeSelectorReachability(result) {
  return {
    meta: result.meta,
    selectorBranches: result.selectorBranches,
    selectorQueries: result.selectorQueries,
    elementMatches: result.elementMatches,
    branchMatches: result.branchMatches,
    diagnostics: result.diagnostics,
    indexes: {
      branchReachabilityBySelectorBranchNodeId: mapEntries(
        result.indexes.branchReachabilityBySelectorBranchNodeId,
      ),
      branchReachabilityBySourceKey: mapEntries(result.indexes.branchReachabilityBySourceKey),
      matchIdsBySelectorBranchNodeId: mapEntries(result.indexes.matchIdsBySelectorBranchNodeId),
      matchIdsByElementId: mapEntries(result.indexes.matchIdsByElementId),
      matchIdsByClassName: mapEntries(result.indexes.matchIdsByClassName),
      branchIdsByRequiredClassName: mapEntries(result.indexes.branchIdsByRequiredClassName),
      branchIdsByStylesheetNodeId: mapEntries(result.indexes.branchIdsByStylesheetNodeId),
      diagnosticIdsBySelectorBranchNodeId: mapEntries(
        result.indexes.diagnosticIdsBySelectorBranchNodeId,
      ),
    },
  };
}

function mapEntries(map) {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}
