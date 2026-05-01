import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactGraph,
  buildLanguageFrontends,
  buildModuleFacts,
  buildProjectBindingResolution,
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
    elementMatchCount: 0,
    branchMatchCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.selectorBranches, []);
  assert.deepEqual(result.elementMatches, []);
  assert.deepEqual(result.branchMatches, []);
  assert.deepEqual(result.diagnostics, []);
});

test("selector reachability matches same-element compound class selectors", async () => {
  const renderStructure = await buildRenderStructureFixture({
    sourceText: 'export function App() { return <button className="button button--primary" />; }\n',
    cssText: ".button.button--primary { color: blue; }\n",
  });

  const result = buildSelectorReachability(renderStructure);
  const branch = findBranch(result, ".button.button--primary");

  assert.equal(branch.status, "definitely-matchable");
  assert.equal(branch.matchIds.length, 1);

  const match = result.indexes.matchById.get(branch.matchIds[0]);
  assert.ok(match);
  assert.deepEqual(match.requiredClassNames, ["button", "button--primary"]);
  assert.equal(match.certainty, "definite");
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

async function buildRenderStructureFixture(input) {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", input.sourceText)
    .withCssFile("src/app.css", input.cssText)
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/app.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const factGraph = buildFactGraph({ snapshot, frontends });
    const moduleFacts = buildModuleFacts({
      source: frontends.source,
      stylesheetFilePaths: ["src/app.css"],
    });
    const symbolResolution = buildProjectBindingResolution({
      source: frontends.source,
      moduleFacts,
      includeTraces: true,
    });
    const symbolicEvaluation = evaluateSymbolicExpressions({
      graph: factGraph.graph,
      cssModuleBindingResolution: symbolResolution,
    });

    return buildRenderStructure({
      graph: factGraph.graph,
      symbolicEvaluation,
      options: {
        includeTraces: true,
      },
      legacy: {
        parsedFiles: frontends.source.files.map((file) => file.legacy.parsedFile),
        moduleFacts,
        symbolResolution,
      },
    });
  } finally {
    await project.cleanup();
  }
}

function findBranch(result, selectorText) {
  const branch = result.selectorBranches.find((candidate) => candidate.branchText === selectorText);
  assert.ok(branch);
  return branch;
}
