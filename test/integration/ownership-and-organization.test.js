import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

test("integration scans report component css used outside its owning component", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile("src/App.tsx", 'export { Button as App } from "./components/Button";\n')
      .withSourceFile(
        "src/components/Button.tsx",
        [
          'import "./Button.css";',
          'export function Button() { return <button className="button" />; }',
        ].join("\n"),
      )
      .withCssFile("src/components/Button.css", ".button {}\n")
      .withSourceFile(
        "src/screens/Other.tsx",
        [
          'import "../components/Button.css";',
          'export function Other() { return <div className="button" />; }',
        ].join("\n"),
      )
      .withConfig({
        ownership: {
          namingConvention: "sibling",
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "component-style-cross-component" &&
            finding.subject?.cssFilePath === "src/components/Button.css",
        ),
      );
    },
  );
});

test("integration scans report narrow global css", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <div className="globalSingle" />; }\n',
      )
      .withCssFile("src/styles/global-single.css", ".globalSingle {}\n")
      .withConfig({
        css: {
          global: ["src/styles/global-single.css"],
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "global-css-not-global" &&
            finding.subject?.cssFilePath === "src/styles/global-single.css",
        ),
      );
    },
  );
});

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
