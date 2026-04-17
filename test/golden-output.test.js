import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { scanReactCss } from "../dist/index.js";
import { formatHumanReadableOutput, formatJsonOutput } from "../dist/cli/format.js";
import { TestProjectBuilder } from "./support/TestProjectBuilder.js";
import { withBuiltProject } from "./support/integrationTestUtils.js";

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
      const actualOutput = formatJsonOutput(normalizedResult, "default");
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
        outputMode: "verbose",
        scanTarget: PROJECT_ROOT_TOKEN,
      });
      const expectedOutput = await readGoldenResource("golden/report-verbose.txt");

      assert.equal(actualOutput.trimEnd(), expectedOutput.trimEnd());
    },
  );
});

async function readGoldenResource(resourcePath) {
  return readFile(new URL(`./resources/${resourcePath}`, import.meta.url), "utf8");
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
