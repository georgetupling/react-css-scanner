import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("dynamic-class-reference reports class references that cannot be reduced statically", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "dynamic-class-reference");
    assert.equal(result.findings[0].severity, "info");
    assert.equal(result.findings[0].confidence, "high");
    assert.equal(result.findings[0].subject.kind, "class-reference");
    assert.equal(result.findings[0].evidence[0].kind, "source-file");
    assert.equal(result.findings[0].traces[0].category, "rule-evaluation");
    assert.equal(result.findings[0].traces[0].children[0].category, "render-expansion");
    assert.equal(result.findings[0].traces[0].children[0].children[0].category, "value-evaluation");
    assert.equal(result.findings[0].data?.rawExpressionText, "props.className");
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report static class references", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="static-class">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".static-class { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report bounded clsx and classnames references", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "import clsx from 'clsx';",
        "import classnames from 'classnames';",
        "export function App(props) {",
        "  return <main className={clsx('root', props.active && 'active', { selected: props.selected }, classnames('nested'))}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      ".root { display: block; }\n.active { color: red; }\n.selected { color: blue; }\n.nested { color: green; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report bounded array joins, concatenation, and templates", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App(props) {",
        "  return <main className={['root', props.active && 'active', `tone-${props.danger ? 'danger' : 'safe'}`, 'icon-' + (props.small ? 'sm' : 'lg')].join(' ')}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [
        ".root { display: block; }",
        ".active { color: red; }",
        ".tone-danger { color: red; }",
        ".tone-safe { color: green; }",
        ".icon-sm { width: 1rem; }",
        ".icon-lg { width: 2rem; }",
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

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report common local and imported class helper patterns", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/classHelpers.ts",
      [
        "export function importedCn(...classes) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function importedVariantClass(name) {",
        "  const classes = { secondary: 'variant-secondary' };",
        "  return classes[name];",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/App.tsx",
      [
        "import classnames from 'classnames';",
        "import { importedCn, importedVariantClass } from './classHelpers';",
        "",
        "function joinClasses(...classes) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "",
        "const localCn = (...args) => joinClasses('local-wrapper', ...args);",
        "",
        "function localVariantClass(variant) {",
        "  switch (variant) {",
        "    case 'danger':",
        "      return 'tone-danger';",
        "    default:",
        "      return 'tone-safe';",
        "  }",
        "}",
        "",
        "function localMapClass(name) {",
        "  const classes = { mapped: 'mapped-class' };",
        "  return classes[name];",
        "}",
        "",
        "export function App(props) {",
        "  const arrayClass = ['array-class', props.ready && 'array-ready'].filter(Boolean).join(' ');",
        "  const tone = props.danger ? 'danger' : 'safe';",
        "  return (",
        "    <main",
        "      className={localCn(",
        "        'root',",
        "        arrayClass,",
        "        classnames('classnames-root', { selected: props.selected }),",
        "        `button--${props.primary ? 'primary' : 'ghost'}`,",
        "        props.disabled ? 'disabled' : 'enabled',",
        "        props.active && 'active',",
        "        'icon-' + (props.small ? 'sm' : 'lg'),",
        "        ['nested-array', props.open && 'open'],",
        "        localVariantClass(tone),",
        "        localMapClass('mapped'),",
        "        importedCn('imported', importedVariantClass('secondary'))",
        "      )}",
        "    >Hello</main>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [
        ".active { color: green; }",
        ".array-class { display: block; }",
        ".array-ready { display: block; }",
        ".button--ghost { display: block; }",
        ".button--primary { display: block; }",
        ".classnames-root { display: block; }",
        ".disabled { opacity: .5; }",
        ".enabled { opacity: 1; }",
        ".icon-lg { width: 2rem; }",
        ".icon-sm { width: 1rem; }",
        ".imported { display: block; }",
        ".local-wrapper { display: block; }",
        ".mapped-class { display: block; }",
        ".nested-array { display: block; }",
        ".open { display: block; }",
        ".root { display: block; }",
        ".selected { display: block; }",
        ".tone-danger { display: block; }",
        ".tone-safe { display: block; }",
        ".variant-secondary { display: block; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/classHelpers.ts"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference still reports helper calls that cannot be bounded", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={joinUnknown('root', props.className)}>Hello</main>; }\n",
    )
    .withCssFile("src/App.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "dynamic-class-reference",
    );
    assert.equal(finding?.data?.rawExpressionText, "joinUnknown('root', props.className)");
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference degrades recursive helper-bound class arrays without overflowing", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "function joinClasses(...classes) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "",
        "export function App() {",
        "  const className = joinClasses('root', className);",
        "  return <main className={className}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".root { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.ok(result.findings.some((finding) => finding.ruleId === "dynamic-class-reference"));
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference degrades recursive boolean bindings without overflowing", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        "  const active = active;",
        "  return <main className={active && 'active'}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".active { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference degrades recursive element access keys without overflowing", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        "  const key = key;",
        "  const classes = { active: 'active' };",
        "  return <main className={classes[key]}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".active { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.ok(result.findings.some((finding) => finding.ruleId === "dynamic-class-reference"));
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference can be disabled from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "dynamic-class-reference": "off",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(result.findings, []);
  } finally {
    await project.cleanup();
  }
});
