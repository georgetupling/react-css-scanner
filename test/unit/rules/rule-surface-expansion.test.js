import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("orphan-css-file reports project stylesheets that cannot reach analyzed React sources", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile("src/Dead.css", ".dead { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/Dead.css"],
    });
    const finding = result.findings.find((candidate) => candidate.ruleId === "orphan-css-file");

    assert.ok(finding);
    assert.equal(finding.severity, "warn");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.subject.kind, "stylesheet");
    assert.equal(finding.data?.stylesheetFilePath, "src/Dead.css");
    assert.deepEqual(finding.data?.sampleClassNames, ["dead"]);
    assertNoRuleFinding(result, "unused-css-class");
  } finally {
    await project.cleanup();
  }
});

test("orphan-css-file ignores imported and intentionally shared stylesheets", async () => {
  const importedProject = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="app">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".app { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: importedProject.rootDir });

    assert.equal(
      result.findings.some((finding) => finding.ruleId === "orphan-css-file"),
      false,
    );
  } finally {
    await importedProject.cleanup();
  }

  const sharedProject = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharedCss: ["src/styles/*.css"],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .withCssFile("src/styles/tokens.css", ".token { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: sharedProject.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/styles/tokens.css"],
    });

    assert.equal(
      result.findings.some((finding) => finding.ruleId === "orphan-css-file"),
      false,
    );
  } finally {
    await sharedProject.cleanup();
  }
});

test("css-module-import-not-used reports unused CSS Module imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button>Save</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "css-module-import-not-used",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "warn");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.subject.kind, "css-module-import");
    assert.equal(finding.data?.localName, "styles");
    assert.equal(finding.data?.stylesheetFilePath, "src/Button.module.css");
    assertNoRuleFinding(result, "unused-css-module-class");
  } finally {
    await project.cleanup();
  }
});

test("unused-css-module-class still reports unused classes when the module import is used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Save</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { color: green; }\n.unused { color: red; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoRuleFinding(result, "css-module-import-not-used");
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.ruleId === "unused-css-module-class" && finding.data?.className === "unused",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("css-module-import-not-used ignores member, destructured, and computed reads", async () => {
  const memberProject = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Save</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: memberProject.rootDir });
    assertNoRuleFinding(result, "css-module-import-not-used");
  } finally {
    await memberProject.cleanup();
  }

  const destructuredProject = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nconst { root } = styles;\nexport function Button() { return <button className={root}>Save</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: destructuredProject.rootDir });
    assertNoRuleFinding(result, "css-module-import-not-used");
  } finally {
    await destructuredProject.cleanup();
  }

  const computedProject = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button({ tone }) { return <button className={styles[tone]}>Save</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".primary { color: green; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: computedProject.rootDir });
    assertNoRuleFinding(result, "css-module-import-not-used");
  } finally {
    await computedProject.cleanup();
  }
});

test("duplicate-class-definition reports duplicate exact selectors in the same stylesheet scope", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <button className="button">Save</button>; }\n',
    )
    .withCssFile(
      "src/App.css",
      [".button { color: green; }", ".button { background: white; }", ""].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "duplicate-class-definition",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "info");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.data?.className, "button");
    assert.equal(finding.data?.selectorText, ".button");
    assert.equal(finding.data?.definitionCount, 2);
    assert.equal(finding.data?.hasConflictingDeclarations, true);
  } finally {
    await project.cleanup();
  }
});

test("duplicate-class-definition ignores pseudo-state and at-rule-separated selectors", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <button className="button">Save</button>; }\n',
    )
    .withCssFile(
      "src/App.css",
      [
        ".button { color: green; }",
        ".button:hover { color: blue; }",
        "@media (min-width: 40rem) {",
        "  .button { color: purple; }",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    assertNoRuleFinding(result, "duplicate-class-definition");
  } finally {
    await project.cleanup();
  }
});

function assertNoRuleFinding(result, ruleId) {
  assert.equal(
    result.findings.some((finding) => finding.ruleId === ruleId),
    false,
  );
}
