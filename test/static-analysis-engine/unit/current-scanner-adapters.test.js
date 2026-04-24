import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectModel,
  extractProjectFacts,
  normalizeScanReactCssConfig,
} from "../../../dist/index.js";
import { writeProjectFile, withRuleTempDir } from "../../support/ruleTestUtils.js";
import { analyzeProjectModelWithStaticEngine } from "../../../dist/static-analysis-engine/adapters/current-scanner/analyzeProjectModelWithStaticEngine.js";
import { buildEngineRenderContextReachabilityBySourceFile } from "../../../dist/static-analysis-engine/adapters/current-scanner/buildEngineRenderContextReachability.js";

test("engine current-scanner adapter keeps stylesheet availability possible across sibling render paths", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import { StyledLayout } from "./StyledLayout";',
        'import { PlainLayout } from "./PlainLayout";',
        "export function App() { return <><StyledLayout /><PlainLayout /></>; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/StyledLayout.tsx",
      [
        'import "./layout.css";',
        'import { Child } from "./Child";',
        "export function StyledLayout() { return <Child />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/PlainLayout.tsx",
      [
        'import { Child } from "./Child";',
        "export function PlainLayout() { return <Child />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Child.tsx",
      'export function Child() { return <div className="page-flow" />; }',
    );
    await writeProjectFile(tempDir, "src/layout.css", ".page-flow {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const engineResult = analyzeProjectModelWithStaticEngine(model, {
      includeExternalCssSources: true,
    });
    const summary = buildEngineRenderContextReachabilityBySourceFile(
      model,
      engineResult.renderGraph,
    );

    const childReachability = summary.get("src/Child.tsx");
    assert.ok(childReachability);
    assert.deepEqual([...childReachability.renderContextDefiniteLocalCss], []);
    assert.deepEqual([...childReachability.renderContextPossibleLocalCss], ["src/layout.css"]);
  });
});

test("engine current-scanner adapter keeps stylesheet availability definite across ancestor render routes", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./Page.css";',
        'import { Wrapper } from "./Wrapper";',
        "export function App() { return <Wrapper />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Wrapper.tsx",
      ['import { Leaf } from "./Leaf";', "export function Wrapper() { return <Leaf />; }"].join(
        "\n",
      ),
    );
    await writeProjectFile(
      tempDir,
      "src/Leaf.tsx",
      'export function Leaf() { return <div className="page-shell" />; }',
    );
    await writeProjectFile(tempDir, "src/Page.css", ".page-shell {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const engineResult = analyzeProjectModelWithStaticEngine(model, {
      includeExternalCssSources: true,
    });
    const summary = buildEngineRenderContextReachabilityBySourceFile(
      model,
      engineResult.renderGraph,
    );

    const leafReachability = summary.get("src/Leaf.tsx");
    assert.ok(leafReachability);
    assert.deepEqual([...leafReachability.renderContextDefiniteLocalCss], ["src/Page.css"]);
    assert.deepEqual([...leafReachability.renderContextPossibleLocalCss], []);
  });
});
