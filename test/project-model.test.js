import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  DEFAULT_CONFIG,
  buildProjectModel,
  extractProjectFacts,
  normalizeReactCssScannerConfig,
} from "../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-model-test-"));

  try {
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

    const config = normalizeReactCssScannerConfig({
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

    const config = normalizeReactCssScannerConfig({
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
