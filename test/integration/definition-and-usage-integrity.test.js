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

test("integration scans surface partial render-context coverage as css-class-missing-in-some-contexts", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/PageWithCss.tsx",
        [
          'import "./Page.css";',
          'import { Child } from "./Child";',
          "export function PageWithCss() { return <Child />; }",
        ].join("\n"),
      )
      .withSourceFile(
        "src/PageWithoutCss.tsx",
        [
          'import { Child } from "./Child";',
          "export function PageWithoutCss() { return <Child />; }",
        ].join("\n"),
      )
      .withSourceFile(
        "src/Child.tsx",
        'export function Child() { return <div className="page-shell" />; }\n',
      )
      .withCssFile("src/Page.css", ".page-shell {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "css-class-missing-in-some-contexts" &&
            finding.subject?.className === "page-shell",
        ),
      );
      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "page-shell",
        ),
      );
      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "unreachable-css" && finding.subject?.className === "page-shell",
        ),
      );
    },
  );
});

test("integration scans treat classes from transitive css @imports as reachable", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import "./index.css";',
          'import { Child } from "./Child";',
          "export function App() { return <Child />; }",
        ].join("\n"),
      )
      .withSourceFile(
        "src/Child.tsx",
        'export function Child() { return <div className="page-flow" />; }\n',
      )
      .withCssFile("src/index.css", '@import "./styles/layout.css";\n')
      .withCssFile("src/styles/layout.css", ".page-flow {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.subject?.className === "page-flow" &&
            (finding.ruleId === "missing-css-class" || finding.ruleId === "unreachable-css"),
        ),
      );
    },
  );
});
