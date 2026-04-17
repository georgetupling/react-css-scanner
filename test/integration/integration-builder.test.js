import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

test("TestProjectBuilder composes template, resource files, and deterministic file output", async () => {
  const builder = new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./components/Button.css";',
        'export function App() { return <div className="button" />; }',
      ].join("\n"),
    );
  await builder.withSourceFileFromResource(
    "src/components/Button.tsx",
    "source/components/Button.tsx",
  );
  await builder.withCssFileFromResource("src/components/Button.css", "css/components/Button.css");

  await withBuiltProject(builder, async (project) => {
    assert.deepEqual(await project.listFiles(), [
      "package.json",
      "src/App.tsx",
      "src/components/Button.css",
      "src/components/Button.tsx",
    ]);

    const result = await scanReactCss({ targetPath: project.rootDir });
    assert.ok(
      !result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "button",
      ),
    );
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.subject?.className === "buttonGhost",
      ),
    );
  });
});

test("integration scans understand css modules loaded from generated projects", async () => {
  const builder = new TestProjectBuilder().withTemplate("basic-react-app");
  await builder.withSourceFileFromResource(
    "src/components/Button.tsx",
    "source/components/ModuleButton.tsx",
  );
  await builder.withCssFileFromResource(
    "src/components/Button.module.css",
    "css/components/Button.module.css",
  );
  builder.withSourceFile(
    "src/App.tsx",
    'export { ModuleButton as App } from "./components/Button";\n',
  );

  await withBuiltProject(builder, async (project) => {
    const result = await scanReactCss({ targetPath: project.rootDir });
    assert.ok(!result.findings.some((finding) => finding.ruleId === "missing-css-module-class"));
  });
});
