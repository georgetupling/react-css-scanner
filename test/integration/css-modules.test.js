import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

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

test("integration scans report missing css module members", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import styles from "./App.module.css";',
          "export function App() { return <><div className={styles.present} /><div className={styles.missing} /></>; }",
        ].join("\n"),
      )
      .withCssFile("src/App.module.css", ".present {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-module-class" &&
            finding.subject?.className === "missing",
        ),
      );
    },
  );
});

test("integration scans report unused css module classes", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/Button.tsx",
        [
          'import styles from "./Button.module.css";',
          "export function Button() { return <div className={styles.used} />; }",
        ].join("\n"),
      )
      .withCssFile("src/Button.module.css", ".used {}\n.unused {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "unused-css-module-class" && finding.subject?.className === "unused",
        ),
      );
    },
  );
});
