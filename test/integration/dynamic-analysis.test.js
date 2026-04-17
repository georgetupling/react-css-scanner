import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

test("integration scans preserve dynamic-class-reference confidence through the full pipeline", async () => {
  const builder = new TestProjectBuilder().withTemplate("basic-react-app");
  await builder.withSourceFileFromResource("src/App.tsx", "source/components/DynamicPanel.tsx");
  builder.withCssFile("src/App.css", ".panel {}\n.open {}\n");

  await withBuiltProject(builder, async (project) => {
    const result = await scanReactCss({ targetPath: project.rootDir });
    const finding = result.findings.find((entry) => entry.ruleId === "dynamic-class-reference");

    assert.ok(finding);
    assert.equal(finding.confidence, "medium");
  });
});

test("integration scans report dynamic missing css classes from helper-composed references", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import classNames from "classnames";',
          "const state = true;",
          'export function App() { return <div className={classNames("panel", state && "missingDynamic")} />; }',
        ].join("\n"),
      ),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "dynamic-missing-css-class" &&
            finding.metadata.sourceExpression === 'state && "missingDynamic"',
        ),
      );
    },
  );
});
