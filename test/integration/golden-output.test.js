import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { scanReactCss } from "../../dist/index.js";
import { formatHumanReadableOutput, formatJsonOutput } from "../../dist/cli/format.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

const PROJECT_ROOT_TOKEN = "<PROJECT_ROOT>";

test("JSON output stays stable for a representative mixed-finding scan", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import "./App.css";',
          'export function App() { return <div className="used missing" />; }',
        ].join("\n"),
      )
      .withCssFile("src/App.css", ".used {}\n.unused {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });
      const normalizedResult = normalizeScanResult(result, project.rootDir);
      const actualOutput = formatJsonOutput(normalizedResult, false);
      const expectedOutput = await readGoldenResource("golden/report-default.json");

      assert.deepEqual(JSON.parse(actualOutput), JSON.parse(expectedOutput));
    },
  );
});

test("human-readable verbose output stays stable for grouped findings", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <div className="orphan" />; }\n',
      )
      .withCssFile("src/Other.css", ".orphan {}\n")
      .withConfig({
        css: {
          global: [],
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });
      const normalizedResult = normalizeScanResult(result, project.rootDir);
      const actualOutput = formatHumanReadableOutput({
        result: normalizedResult,
        verbosity: "high",
        scanTarget: PROJECT_ROOT_TOKEN,
        printConfig: false,
      });
      const expectedOutput = await readGoldenResource("golden/report-verbose.txt");

      assert.equal(actualOutput.trimEnd(), expectedOutput.trimEnd());
    },
  );
});

test("human-readable low verbosity uses compact rows and short disambiguated paths", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withCssFile("src/a/Button.css", ".empty {}\n")
      .withCssFile("src/b/Button.css", ".empty {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });
      const normalizedResult = normalizeScanResult(result, project.rootDir);
      const actualOutput = formatHumanReadableOutput({
        result: normalizedResult,
        verbosity: "low",
        scanTarget: PROJECT_ROOT_TOKEN,
        printConfig: false,
      });

      assert.match(actualOutput, /^Severity\s+Rule\s+Location\s+Subject$/m);
      assert.match(actualOutput, /empty-css-rule\s+a\/Button\.css:1\s+src\/a\/Button\.css/);
      assert.match(actualOutput, /empty-css-rule\s+b\/Button\.css:1\s+src\/b\/Button\.css/);
      assert.doesNotMatch(actualOutput, /Confidence:/);
      assert.match(actualOutput, /^Summary$/m);
    },
  );
});

async function readGoldenResource(resourcePath) {
  return readFile(new URL(`../resources/${resourcePath}`, import.meta.url), "utf8");
}

function normalizeScanResult(result, projectRoot) {
  return {
    ...result,
    configSource: result.configSource
      ? {
          ...result.configSource,
          filePath: result.configSource.filePath
            ? result.configSource.filePath
                .replaceAll(projectRoot, PROJECT_ROOT_TOKEN)
                .replaceAll("\\", "/")
            : result.configSource.filePath,
        }
      : undefined,
  };
}
