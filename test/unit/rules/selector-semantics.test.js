import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("unsatisfiable-selector reports supported selectors with no reachable render match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .missing { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "unsatisfiable-selector",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].confidence, "high");
    assert.equal(findings[0].subject.kind, "selector-query");
    assert.match(findings[0].message, /cannot match/);
    assert.equal(findings[0].data?.selectorText, ".card > .missing");
    assert.equal(findings[0].data?.selectorReachabilityStatus, "not-matchable");
    assert.equal(typeof findings[0].data?.selectorBranchNodeId, "string");
    assert.equal(findings[0].traces[0].category, "rule-evaluation");
    assert.equal(findings[0].traces[0].children[0].category, "selector-match");
  } finally {
    await project.cleanup();
  }
});

test("unsatisfiable-selector does not report selectors with bounded render matches", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unsatisfiable-selector does not report non-local package CSS selectors", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "library/styles.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withFile("node_modules/library/styles.css", ".card > .missing { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("selector-only-matches-in-unknown-contexts reports debug uncertainty for dynamic selector contexts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App(props) {",
        '  return <main className={props.wrapperClass}><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "selector-only-matches-in-unknown-contexts",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "debug");
    assert.equal(findings[0].confidence, "low");
    assert.equal(findings[0].subject.kind, "selector-query");
    assert.equal(findings[0].data?.selectorText, ".card > .title");
    assert.equal(findings[0].data?.selectorReachabilityStatus, "only-matches-in-unknown-context");
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched reports same-node class conjunctions with no render match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <><button className="button">Save</button><span className="primary">Primary</span></>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".button.primary { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const compoundFindings = result.findings.filter(
      (finding) => finding.ruleId === "compound-selector-never-matched",
    );
    assert.equal(compoundFindings.length, 1);
    assert.equal(compoundFindings[0].severity, "warn");
    assert.equal(compoundFindings[0].confidence, "high");
    assert.equal(compoundFindings[0].subject.kind, "selector-query");
    assert.deepEqual(compoundFindings[0].data?.requiredClassNames, ["button", "primary"]);
    assert.equal(compoundFindings[0].data?.selectorText, ".button.primary");
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched does not report matched same-node class conjunctions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <button className="button primary">Save</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".button.primary { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "compound-selector-never-matched"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched does not report non-local package CSS selectors", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "library/styles.css";',
        "export function App() {",
        '  return <button className="button">Save</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withFile("node_modules/library/styles.css", ".button.primary { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "compound-selector-never-matched"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched respects mutually exclusive canonical variants", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "const active = true;",
        "export function App() {",
        '  return <button className={active ? "button primary" : "button danger"}>Save</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [
        ".button { color: black; }",
        ".primary { color: green; }",
        ".danger { color: red; }",
        ".button.primary.danger { outline: 1px solid red; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const compoundFindings = result.findings.filter(
      (finding) =>
        finding.ruleId === "compound-selector-never-matched" &&
        finding.data?.selectorText === ".button.primary.danger",
    );
    assert.equal(compoundFindings.length, 1);
    assert.equal(compoundFindings[0].confidence, "high");
    assert.deepEqual(compoundFindings[0].data?.requiredClassNames, ["button", "primary", "danger"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-compound-selector-branch reports a dead branch in an otherwise useful selector list", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title, .card > .missing { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "unused-compound-selector-branch",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].confidence, "high");
    assert.equal(findings[0].subject.kind, "selector-branch");
    assert.equal(findings[0].data?.selectorText, ".card > .missing");
    assert.equal(findings[0].data?.selectorListText, ".card > .title, .card > .missing");
    assert.equal(findings[0].data?.branchIndex, 1);
    assert.equal(findings[0].data?.branchCount, 2);
    assert.equal(findings[0].traces[0].category, "rule-evaluation");
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-compound-selector-branch does not report when all selector list branches match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span><span className="subtitle">World</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title, .card > .subtitle { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-compound-selector-branch"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("selector analysis follows custom class props and renderable slot children", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./Modal.css";',
        'import { Button } from "./Button";',
        'import { Field } from "./Field";',
        'import { Modal } from "./Modal";',
        "export function App() {",
        "  const footer = <Button>Confirm</Button>;",
        "  return (",
        "    <Modal",
        '      className="image-gallery-wizard-modal"',
        '      panelClassName="image-gallery-wizard-modal__panel"',
        '      bodyClassName="image-gallery-wizard-modal__body"',
        '      footerClassName="image-gallery-wizard-modal__footer"',
        "      footer={footer}",
        "    >",
        '      <Field className="image-gallery-wizard-modal__crop-field" label="Zoom" />',
        "    </Modal>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Modal.tsx",
      [
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Modal({ children, className, panelClassName, bodyClassName, footerClassName, footer }) {",
        "  return (",
        "    <div className={joinClasses('modal', className)}>",
        "      <div className={joinClasses('modal__panel', panelClassName)}>",
        "        <div className={joinClasses('modal__body', bodyClassName)}>{children}</div>",
        "        {footer ? <footer className={joinClasses('modal__footer', footerClassName)}>{footer}</footer> : null}",
        "      </div>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Button.tsx",
      'export function Button({ children }) { return <button className="button">{children}</button>; }\n',
    )
    .withSourceFile(
      "src/Field.tsx",
      "export function Field({ className, label }) { return <label className={['field', className].filter(Boolean).join(' ')}><span className=\"field__label\">{label}</span></label>; }\n",
    )
    .withCssFile(
      "src/Modal.css",
      [
        ".image-gallery-wizard-modal { display: block; }",
        ".image-gallery-wizard-modal__panel { display: grid; }",
        ".image-gallery-wizard-modal__body { padding: 1rem; }",
        ".image-gallery-wizard-modal__footer { display: flex; }",
        ".image-gallery-wizard-modal__crop-field { display: block; }",
        ".image-gallery-wizard-modal__footer .button { margin-inline-start: auto; }",
        ".image-gallery-wizard-modal__crop-field .field__label { font-weight: 600; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "image-gallery-wizard-modal__panel",
      "image-gallery-wizard-modal__body",
      "image-gallery-wizard-modal__footer",
      "image-gallery-wizard-modal__crop-field",
    ]);
    assertNoSelectorFindings(result, "unsatisfiable-selector", [
      ".image-gallery-wizard-modal__footer .button",
      ".image-gallery-wizard-modal__crop-field .field__label",
    ]);
  } finally {
    await project.cleanup();
  }
});

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

function assertNoSelectorFindings(result, ruleId, selectorTexts) {
  assert.deepEqual(
    result.findings
      .filter(
        (finding) =>
          finding.ruleId === ruleId && selectorTexts.includes(finding.data?.selectorText),
      )
      .map((finding) => finding.data?.selectorText),
    [],
  );
}
