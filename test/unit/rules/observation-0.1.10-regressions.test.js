import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { discoverProjectFiles } from "../../../dist/project/discovery.js";
import { analyzeProjectSourceTexts } from "../../../dist/static-analysis-engine.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("0.1.10 regression: unused-css-class treats static JSX classes inside assigned conditional content as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        "export function Button({ isLoading = false, iconOnly = false, loadingLabel, children }) {",
        "  const content = isLoading ? (",
        "    <>",
        '      <span className="button__spinner" aria-hidden="true" />',
        "      {!iconOnly ? <span>{loadingLabel ?? children}</span> : null}",
        "    </>",
        "  ) : (",
        "    children",
        "  );",
        '  return <button className="button">{content}</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [".button { display: inline-flex; }", ".button__spinner { inline-size: 1rem; }", ""].join(
        "\n",
      ),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["button__spinner"]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: unused-css-class treats full Button helper variant assembly as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'type ButtonVariant = "primary" | "ghost" | "ghost-round" | "destructive";',
        'type ButtonSize = "sm" | "md";',
        "type ButtonProps = {",
        "  variant?: ButtonVariant;",
        "  size?: ButtonSize;",
        "  iconOnly?: boolean;",
        "  isLoading?: boolean;",
        "  loadingLabel?: string;",
        "  className?: string;",
        "  children?: unknown;",
        "};",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function Button({",
        "  variant = 'primary',",
        "  size = 'md',",
        "  iconOnly = false,",
        "  isLoading = false,",
        "  loadingLabel,",
        "  className,",
        "  children,",
        "}: ButtonProps) {",
        "  const classes = joinClasses(",
        "    'button',",
        "    `button--${variant}`,",
        "    size === 'sm' && 'button--sm',",
        "    iconOnly && 'button--icon-only',",
        "    className,",
        "  );",
        "  const content = isLoading ? (",
        "    <>",
        '      <span className="button__spinner" aria-hidden="true" />',
        "      {!iconOnly ? <span>{loadingLabel ?? children}</span> : null}",
        "    </>",
        "  ) : (",
        "    children",
        "  );",
        "  return <button className={classes}>{content}</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [
        ".button { display: inline-flex; }",
        ".button--primary { color: white; }",
        ".button--ghost { color: inherit; }",
        ".button--ghost-round { border-radius: 999px; }",
        ".button--destructive { color: red; }",
        ".button--sm { min-height: 2rem; }",
        ".button--icon-only { inline-size: 2.5rem; }",
        ".button__spinner { inline-size: 1rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "button",
      "button--primary",
      "button--ghost",
      "button--ghost-round",
      "button--destructive",
      "button--sm",
      "button--icon-only",
      "button__spinner",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: unused-css-class treats static classes inside cloneElement field children as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/WorldInvitationsPage.tsx",
      [
        'import "./WorldInvitationsPage.css";',
        'import { WorldInvitationFormPanel } from "./WorldInvitationFormPanel";',
        "export function WorldInvitationsPage() {",
        "  return <WorldInvitationFormPanel />;",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/WorldInvitationFormPanel.tsx",
      [
        'import { Field } from "./Field";',
        "export function WorldInvitationFormPanel() {",
        "  return (",
        '    <Field label="Optional Message" hint="Keep it brief.">',
        '      <textarea className="field__input world-invitations-page__message-input" aria-label="Message" />',
        "    </Field>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Field.tsx",
      [
        'import { Children, cloneElement, isValidElement } from "react";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Field({ label, children, className, hint }) {",
        "  const child = Children.only(children);",
        "  if (!isValidElement(child)) {",
        '    throw new Error("Field expects a single form control element child.");',
        "  }",
        "  return (",
        '    <div className={joinClasses("field", className)}>',
        '      <label className="field__label">{label}</label>',
        "      {cloneElement(child, {",
        '        "aria-describedby": hint ? "field-hint" : undefined,',
        "      })}",
        '      {hint ? <p className="field__hint" id="field-hint">{hint}</p> : null}',
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/WorldInvitationsPage.css",
      [
        ".field__input { display: block; }",
        ".world-invitations-page__message-input { min-height: 8rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "field__input",
      "world-invitations-page__message-input",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: cloneElement className replacement indexes added static classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Field.tsx",
      [
        'import { Children, cloneElement } from "react";',
        'import "./Field.css";',
        "export function Field({ children }) {",
        "  const child = Children.only(children);",
        "  return cloneElement(child, {",
        '    className: "field__input",',
        "  });",
        "}",
        "export function App() {",
        '  return <Field><input aria-label="Name" /></Field>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Field.css", [".field__input { display: block; }", ""].join("\n"))
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["field__input"]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: cloneElement className merge preserves child class evidence", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Field.tsx",
      [
        'import { Children, cloneElement } from "react";',
        'import "./Field.css";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Field({ children }) {",
        "  const child = Children.only(children);",
        "  return cloneElement(child, {",
        '    className: joinClasses(child.props.className, "field__input"),',
        "  });",
        "}",
        "export function App() {",
        '  return <Field><textarea className="world-invitations-page__message-input" /></Field>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Field.css",
      [
        ".field__input { display: block; }",
        ".world-invitations-page__message-input { min-height: 8rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "field__input",
      "world-invitations-page__message-input",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: Children.map cloneElement transforms preserve mapped child classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/FieldList.tsx",
      [
        'import { Children, cloneElement } from "react";',
        'import "./FieldList.css";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function FieldList({ children }) {",
        "  return (",
        '    <div className="field-list">',
        "      {Children.map(children, (child) =>",
        "        cloneElement(child, {",
        '          className: joinClasses(child.props.className, "field-list__control"),',
        "        }),",
        "      )}",
        "    </div>",
        "  );",
        "}",
        "export function App() {",
        "  return (",
        "    <FieldList>",
        '      <input className="invite-form__email" />',
        '      <textarea className="invite-form__message" />',
        "    </FieldList>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/FieldList.css",
      [
        ".field-list { display: grid; }",
        ".field-list__control { display: block; }",
        ".invite-form__email { inline-size: 100%; }",
        ".invite-form__message { min-height: 8rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "field-list",
      "field-list__control",
      "invite-form__email",
      "invite-form__message",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: Children.toArray map cloneElement transforms preserve mapped child classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/TabList.tsx",
      [
        'import { Children, cloneElement } from "react";',
        'import "./TabList.css";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function TabList({ children }) {",
        "  return (",
        '    <div className="tab-list">',
        "      {Children.toArray(children).map((child) =>",
        "        cloneElement(child, {",
        '          className: joinClasses(child.props.className, "tab-list__tab"),',
        "        }),",
        "      )}",
        "    </div>",
        "  );",
        "}",
        "export function App() {",
        "  return (",
        "    <TabList>",
        '      <button className="settings-tabs__account">Account</button>',
        '      <button className="settings-tabs__billing">Billing</button>',
        "    </TabList>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/TabList.css",
      [
        ".tab-list { display: flex; }",
        ".tab-list__tab { flex: 1; }",
        ".settings-tabs__account { font-weight: 600; }",
        ".settings-tabs__billing { font-weight: 600; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "tab-list",
      "tab-list__tab",
      "settings-tabs__account",
      "settings-tabs__billing",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: React child transforms index references by class name", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/FieldList.tsx",
        sourceText: [
          'import { Children, cloneElement } from "react";',
          "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
          "export function FieldList({ children }) {",
          "  return Children.map(children, (child) =>",
          "    cloneElement(child, {",
          '      className: joinClasses(child.props.className, "field-list__control"),',
          "    }),",
          "  );",
          "}",
          "export function App() {",
          "  return (",
          "    <FieldList>",
          '      <input className="invite-form__email" />',
          '      <textarea className="invite-form__message" />',
          "    </FieldList>",
          "  );",
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/FieldList.css",
        cssText: [
          ".field-list__control { display: block; }",
          ".invite-form__email { inline-size: 100%; }",
          ".invite-form__message { min-height: 8rem; }",
          "",
        ].join("\n"),
      },
    ],
  });

  assertIndexedClassReferences(result.projectAnalysis, [
    "field-list__control",
    "invite-form__email",
    "invite-form__message",
  ]);
});

test("0.1.10 regression: React child guard APIs do not render child subtrees", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/GuardOnly.tsx",
        sourceText: [
          'import { Children, isValidElement } from "react";',
          "export function GuardOnly({ children }) {",
          "  const count = Children.count(children);",
          "  Children.forEach(children, () => undefined);",
          "  if (!isValidElement(children)) {",
          "    return null;",
          "  }",
          '  return <div className="guard-only">{count}</div>;',
          "}",
          "export function App() {",
          '  return <GuardOnly><span className="child-only" /></GuardOnly>;',
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/GuardOnly.css",
        cssText: ".guard-only { display: block; }\n.child-only { display: block; }\n",
      },
    ],
  });

  assertIndexedClassReferences(result.projectAnalysis, ["guard-only"]);
  assertNoIndexedClassReferences(result.projectAnalysis, ["child-only"]);
});

test("0.1.10 regression: unbounded cloneElement className values remain uncertain", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/DynamicClone.tsx",
        sourceText: [
          'import { Children, cloneElement } from "react";',
          "export function DynamicClone({ children, tone }) {",
          "  const child = Children.only(children);",
          "  return cloneElement(child, {",
          "    className: `field-list__${tone}`,",
          "  });",
          "}",
          "export function App() {",
          '  return <DynamicClone tone={window.location.hash}><input className="stable-child" /></DynamicClone>;',
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/DynamicClone.css",
        cssText: ".stable-child { display: block; }\n.field-list__control { display: block; }\n",
      },
    ],
  });

  assertNoIndexedClassReferences(result.projectAnalysis, ["field-list__control"]);
  assert.ok(
    result.projectAnalysis.entities.classReferences.some(
      (reference) =>
        reference.unknownDynamic &&
        reference.definiteClassNames.length === 0 &&
        reference.possibleClassNames.length === 0,
    ),
  );
});

test("0.1.10 regression: style-used-outside-owner ignores same-family sibling skeleton components", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/features/navigation/components/SiteHeader/SiteHeader.tsx",
      [
        'import "./SiteHeader.css";',
        "export function SiteHeader() {",
        '  return <header className="site-header"><div className="site-header__inner" /></header>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/navigation/components/SiteHeader/SiteHeaderSkeleton.tsx",
      [
        "export function SiteHeaderSkeleton() {",
        '  return <header className="site-header site-header--skeleton"><div className="site-header__inner" /></header>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/features/navigation/components/SiteHeader/SiteHeader.css",
      [
        ".site-header { display: block; }",
        ".site-header__inner { display: flex; }",
        ".site-header--skeleton .site-header__inner { opacity: 0.7; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "style-used-outside-owner", [
      "site-header",
      "site-header__inner",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: style-used-outside-owner ignores scoped primitive override classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/features/navigation/components/SiteHeader/SiteHeader.tsx",
      [
        'import "./SiteHeader.css";',
        'import { DropdownMenu } from "../../../../components/primitives/DropdownMenu";',
        "export function SiteHeader() {",
        '  return <nav className="site-header"><div className="site-header__account-menu"><DropdownMenu /></div></nav>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/primitives/DropdownMenu.tsx",
      [
        "export function DropdownMenu() {",
        '  return <div className="popover__panel">Menu</div>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/features/navigation/components/SiteHeader/SiteHeader.css",
      [
        ".site-header { display: block; }",
        ".site-header__account-menu .popover__panel { min-width: 12rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "style-used-outside-owner", ["popover__panel"]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: style-used-outside-owner ignores generic state class tokens", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/features/home/HomepageFeed/HomepageFeed.tsx",
      [
        'import "./HomepageFeed.css";',
        "export function HomepageFeed() {",
        '  return <section className="homepage-feed is-refreshing">Feed</section>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/pages/WorldArchivePage/WorldArchivePage.tsx",
      [
        'import "./WorldArchivePage.css";',
        "export function WorldArchivePage() {",
        '  return <main className="world-archive-page__content is-refreshing">Archive</main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/features/home/HomepageFeed/HomepageFeed.css",
      [
        ".homepage-feed { display: block; }",
        ".homepage-feed.is-refreshing { opacity: 0.8; }",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/pages/WorldArchivePage/WorldArchivePage.css",
      [
        ".world-archive-page__content { display: grid; }",
        ".world-archive-page__content.is-refreshing { opacity: 0.8; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "style-used-outside-owner", ["is-refreshing"]);
  } finally {
    await project.cleanup();
  }
});

test("0.1.10 regression: ProseMirror missing class findings expose runtime-library hints", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/RichTextEditor.tsx",
      [
        'import { EditorView } from "prosemirror-view";',
        "export function mountEditor(mount, state) {",
        "  new EditorView(",
        "    { mount },",
        "    {",
        "      state,",
        "      attributes: {",
        '        class: "ProseMirror",',
        "      },",
        "    },",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/RichTextEditor.tsx"],
      cssFilePaths: [],
    });
    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-css-class" && candidate.data?.className === "ProseMirror",
    );

    assert.ok(finding);
    assert.equal(finding.data?.runtimeLibraryHint?.packageName, "prosemirror-view");
    assert.equal(finding.data?.runtimeLibraryHint?.cssImportFound, false);
    assert.match(finding.data?.runtimeLibraryHint?.message ?? "", /no package CSS import/);
  } finally {
    await project.cleanup();
  }
});

test(
  "0.1.10 regression: default discovery excludes test source files from analysis scope",
  { todo: "pending discovery-scope test source exclusions" },
  async () => {
    const project = await new TestProjectBuilder()
      .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
      .withSourceFile(
        "src/App.test.tsx",
        'export function AppTestFixture() { return <main className="test-only">Hello</main>; }\n',
      )
      .withSourceFile(
        "src/__tests__/Fixture.tsx",
        'export function Fixture() { return <main className="fixture-only">Hello</main>; }\n',
      )
      .build();

    try {
      const discovered = await discoverProjectFiles({ rootDir: project.rootDir });

      assert.deepEqual(
        discovered.sourceFiles.map((file) => file.filePath),
        ["src/App.tsx"],
      );
    } finally {
      await project.cleanup();
    }
  },
);

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

function assertIndexedClassReferences(analysis, classNames) {
  for (const className of classNames) {
    assert.ok(
      (analysis.indexes.referencesByClassName.get(className) ?? []).length > 0,
      `expected referencesByClassName to contain ${className}`,
    );
  }
}

function assertNoIndexedClassReferences(analysis, classNames) {
  for (const className of classNames) {
    assert.deepEqual(
      analysis.indexes.referencesByClassName.get(className) ?? [],
      [],
      `expected referencesByClassName not to contain ${className}`,
    );
  }
}
