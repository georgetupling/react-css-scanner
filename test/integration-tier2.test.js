import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../dist/index.js";
import { TestProjectBuilder, loadTestResource } from "./support/TestProjectBuilder.js";
import { withBuiltProject } from "./support/integrationTestUtils.js";

test("integration scans report page css used by a single component", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/OnlyOne.tsx",
        [
          'import "./pages/Home.css";',
          'export function OnlyOne() { return <div className="pageSolo" />; }',
        ].join("\n"),
      )
      .withCssFile("src/pages/Home.css", ".pageSolo {}\n")
      .withConfig({
        ownership: {
          pagePatterns: ["src/pages/**/*"],
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "page-style-used-by-single-component" &&
            finding.subject?.cssFilePath === "src/pages/Home.css",
        ),
      );
    },
  );
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

test("integration scans report missing external css classes when imports do not provide them", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import "bootstrap/dist/css/bootstrap.css";',
          'export function App() { return <div className="btn ghost-btn" />; }',
        ].join("\n"),
      )
      .withNodeModuleFile(
        "bootstrap/dist/css/bootstrap.css",
        await loadTestResource("external/library.css"),
      ),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-external-css-class" &&
            finding.subject?.className === "ghost-btn",
        ),
      );
    },
  );
});

test("integration scans report duplicate css class definitions", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withCssFile("src/A.css", ".shared {}\n")
      .withCssFile("src/B.css", ".shared {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "duplicate-css-class-definition" &&
            finding.subject?.className === "shared",
        ),
      );
    },
  );
});

test("integration scans report component css that should likely be global", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/components/Button.tsx",
        [
          'import "./Button.css";',
          'export function Button() { return <button className="button" />; }',
        ].join("\n"),
      )
      .withCssFile("src/components/Button.css", ".button {}\n")
      .withSourceFile(
        "src/screens/One.tsx",
        [
          'import "../components/Button.css";',
          'export function One() { return <div className="button" />; }',
        ].join("\n"),
      )
      .withSourceFile(
        "src/screens/Two.tsx",
        [
          'import "../components/Button.css";',
          'export function Two() { return <div className="button" />; }',
        ].join("\n"),
      )
      .withConfig({
        ownership: {
          namingConvention: "sibling",
        },
        rules: {
          "component-css-should-be-global": {
            severity: "info",
            threshold: 2,
          },
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "component-css-should-be-global" &&
            finding.subject?.cssFilePath === "src/components/Button.css",
        ),
      );
    },
  );
});
