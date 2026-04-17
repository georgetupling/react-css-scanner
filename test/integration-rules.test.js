import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../dist/index.js";
import { TestProjectBuilder, loadTestResource } from "./support/TestProjectBuilder.js";
import { withBuiltProject } from "./support/integrationTestUtils.js";

test("integration scans parse imported external CSS from node_modules", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("react-app-with-external-css")
      .withNodeModuleFile("library/styles.css", await loadTestResource("external/library.css")),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "library-btn",
        ),
      );
    },
  );
});

test("integration scans ignore dependency css that is present but never imported", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <div className="library-btn" />; }\n',
      )
      .withNodeModuleFile("library/styles.css", await loadTestResource("external/library.css")),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "library-btn",
        ),
      );
    },
  );
});

test("integration scans understand classnames and clsx helper calls", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import classNames from "classnames";',
          'import clsx from "clsx";',
          'import "./App.css";',
          "export function App() {",
          '  const first = classNames("alpha", "beta");',
          '  const second = clsx("gamma", "delta");',
          "  return <div className={`${first} ${second}`} />;",
          "}",
        ].join("\n"),
      )
      .withCssFile("src/App.css", ".alpha {}\n.beta {}\n.gamma {}\n.delta {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      for (const className of ["alpha", "beta", "gamma", "delta"]) {
        assert.ok(
          !result.findings.some(
            (finding) =>
              finding.ruleId === "missing-css-class" && finding.subject?.className === className,
          ),
        );
      }
    },
  );
});

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

test("integration focus filters findings without dropping full-project context", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile("src/App.tsx", 'export { Feature as App } from "./feature/Feature";\n')
      .withSourceFile(
        "src/feature/Feature.tsx",
        [
          'import "./Feature.css";',
          'export function Feature() { return <div className="feature" />; }',
        ].join("\n"),
      )
      .withCssFile("src/feature/Feature.css", ".feature {}\n")
      .withSourceFile(
        "src/other/Other.tsx",
        [
          'import "../feature/Feature.css";',
          'export function Other() { return <><div className="feature" /><div className="missingOutside" /></>; }',
        ].join("\n"),
      )
      .withConfig({
        ownership: {
          namingConvention: "sibling",
        },
      }),
    async (project) => {
      const result = await scanReactCss({
        targetPath: project.rootDir,
        focusPath: "src/feature",
      });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "component-style-cross-component" &&
            finding.subject?.cssFilePath === "src/feature/Feature.css",
        ),
      );
      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" &&
            finding.subject?.className === "missingOutside",
        ),
      );
      assert.equal(result.summary.sourceFileCount, 3);
    },
  );
});

test("integration scans report narrow global css and utility replacement opportunities", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <div className="globalSingle" />; }\n',
      )
      .withSourceFile(
        "src/Card.tsx",
        [
          'import "./components/Card.css";',
          'export function Card() { return <div className="cardStack" />; }',
        ].join("\n"),
      )
      .withCssFile("src/styles/global-single.css", ".globalSingle {}\n")
      .withCssFile("src/styles/utilities.css", ".u-stack { display: flex; gap: 8px; }\n")
      .withCssFile(
        "src/components/Card.css",
        ".cardStack { display: flex; gap: 8px; color: red; }\n",
      )
      .withConfig({
        css: {
          global: ["src/styles/global-single.css"],
          utilities: ["src/styles/utilities.css"],
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
      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "utility-class-replacement" &&
            finding.subject?.className === "cardStack",
        ),
      );
    },
  );
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
