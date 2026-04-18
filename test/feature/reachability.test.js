import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  buildProjectModel,
  extractProjectFacts,
  normalizeScanReactCssConfig,
} from "../../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-reachability-test-"));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "reachability-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
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

test("direct local css imports are reachable from the importing source file", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/components/Button.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.localCss], ["src/components/Button.css"]);
    assert.deepEqual([...reachability.globalCss], []);
    assert.deepEqual([...reachability.externalCss], []);
  });
});

test("configured global css is reachable from every source file", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/App.tsx", "export const App = () => null;");
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      "export const Button = () => null;",
    );
    await writeProjectFile(tempDir, "src/styles/global.css", ".global {}");

    const config = normalizeScanReactCssConfig({
      css: {
        global: ["src/styles/global.css"],
      },
    });
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });

    assert.deepEqual(
      [...(model.reachability.get("src/App.tsx")?.globalCss ?? [])],
      ["src/styles/global.css"],
    );
    assert.deepEqual(
      [...(model.reachability.get("src/components/Button.tsx")?.globalCss ?? [])],
      ["src/styles/global.css"],
    );
  });
});

test("entry-imported global css in main.tsx is reachable from the imported app module", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/main.tsx",
      [
        'import "./styles/global.css";',
        'import { App } from "./App";',
        "export function Main() { return <App />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <main className="app-shell" />; }',
    );
    await writeProjectFile(tempDir, "src/styles/global.css", ".app-shell {}");

    const config = normalizeScanReactCssConfig({
      css: {
        global: ["src/styles/global.css"],
      },
    });
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });

    assert.deepEqual(
      [...(model.reachability.get("src/App.tsx")?.globalCss ?? [])],
      ["src/styles/global.css"],
    );
  });
});

test("parent source imports contribute reachable local and external css", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/pages/HomePage.tsx",
      [
        'import "../styles/page.css";',
        'import "bootstrap/dist/css/bootstrap.css";',
        'import "../components/Button";',
        "export function HomePage() { return null; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      'export function Button() { return <button className="page btn" />; }',
    );
    await writeProjectFile(tempDir, "src/styles/page.css", ".page {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/components/Button.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.localCss], ["src/styles/page.css"]);
    assert.deepEqual([...reachability.externalCss], ["bootstrap/dist/css/bootstrap.css"]);
  });
});

test("barrel re-exports preserve reachable css from higher-level importers", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/pages/HomePage.tsx",
      [
        'import "../styles/page.css";',
        'import "../components";',
        "export function HomePage() { return null; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/components/index.ts",
      'export { Button } from "./Button";',
    );
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      'export function Button() { return <button className="page" />; }',
    );
    await writeProjectFile(tempDir, "src/styles/page.css", ".page {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/components/Button.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.localCss], ["src/styles/page.css"]);
  });
});

test("local css reachability includes transitive css @imports", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./index.css";',
        'export function App() { return <main className="page-flow" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/index.css", '@import "./styles/layout.css";\n');
    await writeProjectFile(tempDir, "src/styles/layout.css", ".page-flow {}\n");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/App.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.directLocalCss], ["src/index.css"]);
    assert.deepEqual([...reachability.localCss], ["src/index.css", "src/styles/layout.css"]);
  });
});

test("ancestor import-context reachability includes transitive css @imports", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Page.tsx",
      [
        'import "./index.css";',
        'import { Child } from "./Child";',
        "export function Page() { return <Child />; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Child.tsx",
      'export function Child() { return <section className="page-flow" />; }\n',
    );
    await writeProjectFile(tempDir, "src/index.css", '@import "./styles/layout.css";\n');
    await writeProjectFile(tempDir, "src/styles/layout.css", ".page-flow {}\n");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/Child.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.directLocalCss], []);
    assert.deepEqual(
      [...reachability.importContextLocalCss],
      ["src/index.css", "src/styles/layout.css"],
    );
    assert.deepEqual([...reachability.localCss], ["src/index.css", "src/styles/layout.css"]);
  });
});

test("transitive css @import reachability terminates cleanly for cycles", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      ['import "./a.css";', 'export function App() { return <main className="cycle-b" />; }'].join(
        "\n",
      ),
    );
    await writeProjectFile(tempDir, "src/a.css", '@import "./b.css";\n.cycle-a {}\n');
    await writeProjectFile(tempDir, "src/b.css", '@import "./a.css";\n.cycle-b {}\n');

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    const reachability = model.reachability.get("src/App.tsx");

    assert.ok(reachability);
    assert.deepEqual([...reachability.directLocalCss], ["src/a.css"]);
    assert.deepEqual([...reachability.localCss], ["src/a.css", "src/b.css"]);
  });
});
