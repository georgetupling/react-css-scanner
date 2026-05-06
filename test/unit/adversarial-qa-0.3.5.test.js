import assert from "node:assert/strict";
import test from "node:test";

import { scanProject } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("QA 0.3.5: imported class constants are checked at the consuming render site for CSS reachability", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'import { rootClass } from "./classes";',
        "export function App() { return <main className={rootClass}>Hello</main>; }",
        "",
      ].join("\n"),
    )
    .withSourceFile("src/classes.ts", 'export const rootClass = "root";\n')
    .withCssFile("src/App.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "css-class-unreachable", ["root"]);
    assertNoClassFindings(result, "missing-css-class", ["root"]);
    assertNoClassFindings(result, "unused-css-class", ["root"]);
  } finally {
    await project.cleanup();
  }
});

test("QA 0.3.5: imported object property class constants keep CSS live", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'import { classes } from "./classes";',
        "export function App() { return <main className={classes.root}>Hello</main>; }",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/classes.ts",
      ["export const classes = {", '  root: "root",', "} as const;", ""].join("\n"),
    )
    .withCssFile("src/App.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["root"]);
    assertNoClassFindings(result, "missing-css-class", ["root"]);
    assertNoClassFindings(result, "css-class-unreachable", ["root"]);
  } finally {
    await project.cleanup();
  }
});

test("QA 0.3.5: imported default object property class constants keep CSS live", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'import classes from "./classes";',
        "export function App() { return <main className={classes.root}>Hello</main>; }",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/classes.ts",
      ["const classes = {", '  root: "root",', "} as const;", "export default classes;", ""].join(
        "\n",
      ),
    )
    .withCssFile("src/App.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["root"]);
    assertNoClassFindings(result, "missing-css-class", ["root"]);
    assertNoClassFindings(result, "css-class-unreachable", ["root"]);
  } finally {
    await project.cleanup();
  }
});

test("QA 0.3.5: imported const tuple joins keep all finite classes live", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'import { classes } from "./classes";',
        'export function App() { return <main className={classes.join(" ")}>Hello</main>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile("src/classes.ts", 'export const classes = ["root", "elevated"] as const;\n')
    .withCssFile(
      "src/App.css",
      ".root { color: green; }\n.elevated { box-shadow: 0 0 2px black; }\n",
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["root", "elevated"]);
    assertNoClassFindings(result, "missing-css-class", ["root", "elevated"]);
    assertNoClassFindings(result, "css-class-unreachable", ["root", "elevated"]);
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: prefix class attribute selectors satisfy matching classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <div className="icon-save">Save</div>; }\n',
    )
    .withCssFile("src/App.css", '[class^="icon-"] { color: green; }\n')
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["icon-save"]);
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: substring class attribute selectors satisfy matching classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <div className="btn-primary">Save</div>; }\n',
    )
    .withCssFile("src/App.css", '[class*="btn-"] { color: green; }\n')
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["btn-primary"]);
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: native CSS nesting descendant selectors define nested classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'export function App() { return <section className="card"><h2 className="title">Title</h2></section>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card {\n  & .title {\n    color: green;\n  }\n}\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["title"]);
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: native CSS nesting compound self selectors define state classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <section className="card active">Hello</section>; }\n',
    )
    .withCssFile("src/App.css", ".card {\n  &.active {\n    color: green;\n  }\n}\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["active"]);
  } finally {
    await project.cleanup();
  }
});

test.todo(
  "QA 0.3.5: slotted children between siblings make adjacent selectors unsatisfiable",
  async () => {
    const project = await new TestProjectBuilder()
      .withSourceFile(
        "src/App.tsx",
        [
          'import "./App.css";',
          "function Shell({ children }: { children: React.ReactNode }) {",
          '  return <><span className="first">One</span>{children}<span className="second">Two</span></>;',
          "}",
          "export function App() {",
          "  return <Shell><em>gap</em></Shell>;",
          "}",
          "",
        ].join("\n"),
      )
      .withCssFile("src/App.css", ".first + .second { margin-left: 0.5rem; }\n")
      .build();

    try {
      const result = await scanProject({ rootDir: project.rootDir });

      assertHasSelectorFinding(result, "unsatisfiable-selector", ".first + .second");
    } finally {
      await project.cleanup();
    }
  },
);

test("QA 0.3.5: statically truthy logical-or fallback classes are unused", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  const className = "actual" || "fallback";',
        "  return <div className={className}>Hello</div>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".actual { color: green; }\n.fallback { color: red; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["actual"]);
    assertHasClassFinding(result, "unused-css-class", "fallback");
  } finally {
    await project.cleanup();
  }
});

test("QA 0.3.5: const false conditional render classes are unused", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "const enabled = false;",
        "export function App() {",
        '  return <>{enabled && <div className="never">Never</div>}</>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".never { color: red; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertHasClassFinding(result, "unused-css-class", "never");
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: finite mapped template variants report missing classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'const items = ["primary", "secondary"] as const;',
        "export function App() {",
        "  return <>{items.map((tone) => <button className={`btn-${tone}`} key={tone}>Save</button>)}</>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".btn-primary { color: blue; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["btn-primary"]);
    assertHasClassFinding(result, "missing-css-class", "btn-secondary");
  } finally {
    await project.cleanup();
  }
});

test.todo("QA 0.3.5: CSS Module destructuring inside components is not dynamic", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import styles from "./App.module.css";',
        "export function App() {",
        "  const { used } = styles;",
        "  return <div className={used}>Hello</div>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.module.css", ".used { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoRuleFindings(result, "dynamic-class-reference");
    assertNoClassFindings(result, "unused-css-module-class", ["used"]);
    assertNoClassFindings(result, "missing-css-module-class", ["used"]);
  } finally {
    await project.cleanup();
  }
});

function assertHasClassFinding(result, ruleId, className) {
  assert.equal(
    result.findings.some(
      (finding) => finding.ruleId === ruleId && finding.data?.className === className,
    ),
    true,
  );
}

function assertHasSelectorFinding(result, ruleId, selectorText) {
  assert.equal(
    result.findings.some(
      (finding) => finding.ruleId === ruleId && finding.data?.selectorText === selectorText,
    ),
    true,
  );
}

function assertNoRuleFindings(result, ruleId) {
  assert.deepEqual(
    result.findings.filter((finding) => finding.ruleId === ruleId),
    [],
  );
}

function assertNoClassFindings(result, ruleId, classNames) {
  assert.deepEqual(
    result.findings
      .filter(
        (finding) => finding.ruleId === ruleId && classNames.includes(finding.data?.className),
      )
      .map((finding) => finding.data?.className),
    [],
  );
}
