import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

test("integration scans report missing and unreachable css distinctly", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <><div className="missing" /><div className="orphan" /></>; }\n',
      )
      .withCssFile("src/Other.css", ".orphan {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
        ),
      );
      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "unreachable-css" && finding.subject?.className === "orphan",
        ),
      );
    },
  );
});

test("integration scans treat transparently joined helper classes as real usage", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import "./App.css";',
          "function joinClasses(...classes) {",
          '  return classes.filter(Boolean).join(" ");',
          "}",
          "const isSmall = true;",
          'export function App() { return <button className={joinClasses("button", isSmall && "button--sm")} />; }',
        ].join("\n"),
      )
      .withCssFile("src/App.css", ".button {}\n.button--sm {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "unused-css-class" &&
            (finding.subject?.className === "button" ||
              finding.subject?.className === "button--sm"),
        ),
      );
      assert.ok(
        !result.findings.some(
          (finding) =>
            (finding.ruleId === "missing-css-class" ||
              finding.ruleId === "dynamic-class-reference") &&
            (finding.subject?.className === "button" ||
              finding.subject?.className === "button--sm"),
        ),
      );
    },
  );
});
