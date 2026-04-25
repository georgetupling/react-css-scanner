import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("CSS Module rules do not report used module classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-module-class reports missing module members", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.missing}>Button</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });
    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "missing-css-module-class",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "error");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.location?.filePath, "src/Button.tsx");
    assert.equal(finding.subject.kind, "css-module-member-reference");
    assert.equal(finding.evidence[0].kind, "css-module-import");
    assert.equal(finding.data?.memberName, "missing");
    assert.equal(finding.data?.stylesheetFilePath, "src/Button.module.css");
    assert.equal(
      result.findings.some((candidate) => candidate.ruleId === "missing-css-class"),
      false,
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-module-class reports exported module classes without member usage", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n.unused { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });
    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "unused-css-module-class",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "warn");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.subject.kind, "class-definition");
    assert.equal(finding.data?.className, "unused");
    assert.equal(finding.data?.stylesheetFilePath, "src/Button.module.css");
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules support string-literal element access", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles["root"]}>Button</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules support namespace imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      'import * as styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules support named imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import { fooBar, button as buttonClass } from "./Button.module.css";',
        "export function Button() { return <button className={buttonClass}>Button</button>; }",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Button.module.css", ".foo-bar { display: block; }\n.button { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules treat destructured bindings as module member usage", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "const { root, button: buttonClass } = styles;",
        "export function Button() { return <button className={buttonClass}>Button</button>; }",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n.button { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules resolve member usage through simple aliases", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "const s = styles;",
        "export function Button() { return <button className={s.root}>Button</button>; }",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Button.module.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx"],
      cssFilePaths: ["src/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module rules respect camelCase locals convention", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "export function Button() { return <button className={styles.fooBar}>Button</button>; }",
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button.module.css", ".foo-bar { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx"],
      cssFilePaths: ["src/components/Button.module.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-module-class" ||
          finding.ruleId === "unused-css-module-class",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("CSS Module locals convention can require exact export names", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "export function Button() { return <button className={styles.fooBar}>Button</button>; }",
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button.module.css", ".foo-bar { display: block; }\n")
    .withConfig({
      cssModules: {
        localsConvention: "asIs",
      },
    })
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx"],
      cssFilePaths: ["src/components/Button.module.css"],
    });

    assert.equal(
      result.findings.some((finding) => finding.ruleId === "missing-css-module-class"),
      true,
    );
    assert.equal(
      result.findings.some((finding) => finding.ruleId === "unused-css-module-class"),
      true,
    );
  } finally {
    await project.cleanup();
  }
});
