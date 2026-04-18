import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  DEFAULT_CONFIG,
  buildProjectModel,
  extractProjectFacts,
  normalizeScanReactCssConfig,
} from "../../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-model-test-"));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "model-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

test("builds a queryable model with source, css, and external-css indexes", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./App.css";',
        'import "bootstrap/dist/css/bootstrap.css";',
        'export function App() { return <div className="app" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/App.css", ".app {}");

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({
      config: DEFAULT_CONFIG,
      facts,
    });

    assert.ok(model.indexes.sourceFileByPath.has("src/App.tsx"));
    assert.ok(model.indexes.cssFileByPath.has("src/App.css"));
    assert.ok(model.indexes.externalCssBySpecifier.has("bootstrap/dist/css/bootstrap.css"));
    assert.ok(model.indexes.classDefinitionsByName.has("app"));
    assert.ok(model.indexes.classReferencesByName.has("app"));
  });
});

test("classifies ownership using configured global, utility, page, and component patterns", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/pages/Home.tsx", "export const Home = () => null;");
    await writeProjectFile(tempDir, "src/pages/Home.css", ".page {}");
    await writeProjectFile(tempDir, "src/styles/global.css", ".global {}");
    await writeProjectFile(tempDir, "src/styles/utilities.css", ".u-flex {}");
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");

    const config = normalizeScanReactCssConfig({
      css: {
        global: ["src/styles/global.css"],
        utilities: ["**/utilities.css"],
      },
      ownership: {
        pagePatterns: ["src/pages/**/*"],
        componentCssPatterns: ["src/components/**/*.css"],
        namingConvention: "off",
      },
    });

    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });

    assert.equal(model.indexes.cssFileByPath.get("src/styles/global.css")?.ownership, "global");
    assert.equal(model.indexes.cssFileByPath.get("src/styles/utilities.css")?.ownership, "utility");
    assert.equal(model.indexes.cssFileByPath.get("src/pages/Home.css")?.ownership, "page");
    assert.equal(
      model.indexes.cssFileByPath.get("src/components/Button.css")?.ownership,
      "component",
    );
  });
});

test("sibling naming convention can classify css as component-local", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      'export function Button() { return <button className="button" />; }',
    );
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");
    await writeProjectFile(tempDir, "src/components/Loose.css", ".loose {}");

    const config = normalizeScanReactCssConfig({
      ownership: {
        namingConvention: "sibling",
      },
    });

    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });

    assert.equal(
      model.indexes.cssFileByPath.get("src/components/Button.css")?.ownership,
      "component",
    );
    assert.equal(
      model.indexes.cssFileByPath.get("src/components/Loose.css")?.ownership,
      "unclassified",
    );
  });
});

test("graph edges are deterministic and include css-module relationships", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import styles from "./App.module.css";',
        "export function App() { return <div className={styles.root} />; }",
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/App.module.css", ".root {}");

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    assert.ok(
      model.graph.edges.some(
        (edge) =>
          edge.type === "css-module-import" &&
          edge.from === "src/App.tsx" &&
          edge.to === "src/App.module.css",
      ),
    );
    assert.ok(
      model.graph.edges.some(
        (edge) =>
          edge.type === "class-definition" &&
          edge.from === "src/App.module.css" &&
          edge.to === "root",
      ),
    );
    assert.ok(
      model.graph.edges.some(
        (edge) =>
          edge.type === "class-reference" && edge.from === "src/App.tsx" && edge.to === "root",
      ),
    );
  });
});

test("render edges contribute ancestor-context css reachability", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/pages/Page.tsx",
      [
        'import "./Page.css";',
        'import { Child } from "../components/Child";',
        "export function Page() { return <Child />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/components/Child.tsx",
      'export function Child() { return <div className="page-shell" />; }',
    );
    await writeProjectFile(tempDir, "src/pages/Page.css", ".page-shell {}");

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    assert.ok(
      model.graph.edges.some(
        (edge) =>
          edge.type === "render" &&
          edge.from === "src/pages/Page.tsx" &&
          edge.to === "src/components/Child.tsx",
      ),
    );

    const childReachability = model.reachability.get("src/components/Child.tsx");
    assert.ok(childReachability);
    assert.equal(childReachability.directLocalCss.size, 0);
    assert.ok(childReachability.importContextLocalCss.has("src/pages/Page.css"));
    assert.ok(childReachability.localCss.has("src/pages/Page.css"));
    assert.ok(childReachability.renderContextDefiniteLocalCss.has("src/pages/Page.css"));
    assert.equal(childReachability.renderContextPossibleLocalCss.size, 0);
  });
});

test("unresolved uppercase JSX targets do not create render edges", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      "export function App() { return <MissingWidget />; }",
    );

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    assert.ok(!model.graph.edges.some((edge) => edge.type === "render"));
  });
});

test("wrapper-imported css reaches leaf components through render ancestry", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import { Wrapper } from "./Wrapper";',
        "export function App() { return <Wrapper />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Wrapper.tsx",
      [
        'import "./Field.css";',
        'import { Leaf } from "./Leaf";',
        "export function Wrapper() { return <Leaf />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Leaf.tsx",
      'export function Leaf() { return <div className="field__hint" />; }',
    );
    await writeProjectFile(tempDir, "src/Field.css", ".field__hint {}");

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    const leafReachability = model.reachability.get("src/Leaf.tsx");
    assert.ok(leafReachability);
    assert.ok(leafReachability.renderContextDefiniteLocalCss.has("src/Field.css"));
    assert.equal(leafReachability.renderContextPossibleLocalCss.size, 0);
  });
});

test("route-based reachability includes css from higher ancestors on a single render path", async () => {
  await withTempDir(async (tempDir) => {
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

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    const leafReachability = model.reachability.get("src/Leaf.tsx");
    assert.ok(leafReachability);
    assert.ok(leafReachability.renderContextDefiniteLocalCss.has("src/Page.css"));
    assert.equal(leafReachability.renderContextPossibleLocalCss.size, 0);
  });
});

test("route-based reachability works when the css provider is five ancestors away", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./DeepPage.css";',
        'import { LevelOne } from "./LevelOne";',
        "export function App() { return <LevelOne />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/LevelOne.tsx",
      [
        'import { LevelTwo } from "./LevelTwo";',
        "export function LevelOne() { return <LevelTwo />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/LevelTwo.tsx",
      [
        'import { LevelThree } from "./LevelThree";',
        "export function LevelTwo() { return <LevelThree />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/LevelThree.tsx",
      [
        'import { LevelFour } from "./LevelFour";',
        "export function LevelThree() { return <LevelFour />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/LevelFour.tsx",
      [
        'import { LevelFive } from "./LevelFive";',
        "export function LevelFour() { return <LevelFive />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/LevelFive.tsx",
      ['import { Leaf } from "./Leaf";', "export function LevelFive() { return <Leaf />; }"].join(
        "\n",
      ),
    );
    await writeProjectFile(
      tempDir,
      "src/Leaf.tsx",
      'export function Leaf() { return <div className="deep-shell" />; }',
    );
    await writeProjectFile(tempDir, "src/DeepPage.css", ".deep-shell {}");

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });

    const leafReachability = model.reachability.get("src/Leaf.tsx");
    assert.ok(leafReachability);
    assert.ok(leafReachability.renderContextDefiniteLocalCss.has("src/DeepPage.css"));
  });
});

test("activates declared external css providers from matching html stylesheet links", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "index.html",
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" /></head><body></body></html>',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <i className="fa-solid fa-plus" />; }',
    );

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });
    const provider = model.indexes.activeExternalCssProviders.get("font-awesome");

    assert.ok(provider);
    assert.deepEqual(provider.classPrefixes, ["fa-"]);
    assert.ok(provider.classNames.includes("fa-solid"));
    assert.deepEqual(provider.matchedStylesheets, [
      {
        filePath: "index.html",
        href: "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
        isRemote: true,
      },
    ]);
  });
});

test("activates bootstrap-icons provider from matching html stylesheet links", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "index.html",
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css" /></head><body></body></html>',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <i className="bi bi-trash" />; }',
    );

    const facts = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const model = buildProjectModel({ config: DEFAULT_CONFIG, facts });
    const provider = model.indexes.activeExternalCssProviders.get("bootstrap-icons");

    assert.ok(provider);
    assert.deepEqual(provider.classPrefixes, ["bi-"]);
    assert.ok(provider.classNames.includes("bi"));
    assert.deepEqual(provider.matchedStylesheets, [
      {
        filePath: "index.html",
        href: "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css",
        isRemote: true,
      },
    ]);
  });
});
