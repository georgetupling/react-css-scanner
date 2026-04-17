import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { runCli, runCliWithOptions } from "../support/cliTestUtils.js";
import { withBuiltProject, withTempDir } from "../support/integrationTestUtils.js";

test("project-root config makes configured global CSS reachable in integration scans", async () => {
  const builder = new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="app-shell" />; }\n',
    );
  await builder.withGlobalCssFromResource("css/global.css");
  builder.withConfig({
    css: {
      global: ["src/styles/global.css"],
    },
  });

  await withBuiltProject(builder, async (project) => {
    const result = await scanReactCss({ targetPath: project.rootDir });

    assert.equal(result.configSource?.kind, "project-root");
    assert.ok(
      !result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "app-shell",
      ),
    );
  });
});

test("CLI integration fails on configured warning severity", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        ['import "./App.css";', 'export function App() { return <div className="used" />; }'].join(
          "\n",
        ),
      )
      .withCssFile("src/App.css", ".used {}\n.unused {}\n")
      .withConfig({
        policy: {
          failOnSeverity: "warning",
        },
      }),
    async (project) => {
      const result = await runCli([project.rootDir], project.rootDir);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /unused-css-class/);
    },
  );
});

test("CLI uses env-dir config when project-root config is absent", async () => {
  await withTempDir(async (configDir) => {
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "react-css-scanner.json"),
      `${JSON.stringify(
        {
          css: {
            global: ["src/styles/global.css"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const builder = new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <main className="app-shell" />; }\n',
      );
    await builder.withGlobalCssFromResource("css/global.css");

    await withBuiltProject(builder, async (project) => {
      const result = await runCliWithOptions([project.rootDir], project.rootDir, {
        env: {
          REACT_CSS_SCANNER_CONFIG_DIR: configDir,
        },
      });

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Config source: env-dir/);
      assert.doesNotMatch(result.stderr, /built-in defaults were used/i);
      assert.doesNotMatch(result.stdout, /missing-css-class/);
    });
  });
});

test("CLI --config overrides discovered project-root config", async () => {
  await withTempDir(async (configDir) => {
    const explicitConfigPath = path.join(configDir, "explicit-react-css-scanner.json");
    await writeFile(
      explicitConfigPath,
      `${JSON.stringify(
        {
          css: {
            global: ["src/styles/global.css"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const builder = new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <main className="app-shell" />; }\n',
      )
      .withConfig({
        css: {
          global: [],
        },
      });
    await builder.withGlobalCssFromResource("css/global.css");

    await withBuiltProject(builder, async (project) => {
      const result = await runCli(
        [project.rootDir, "--config", explicitConfigPath],
        project.rootDir,
      );

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Config source: explicit-path/);
      assert.doesNotMatch(result.stdout, /missing-css-class/);
    });
  });
});
