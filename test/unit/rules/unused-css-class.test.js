import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("unused-css-class reports unreferenced local CSS classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile("src/App.css", ".unused { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "unused-css-class");
    assert.equal(result.findings[0].severity, "warn");
    assert.equal(result.findings[0].confidence, "high");
    assert.equal(result.findings[0].data?.className, "unused");
    assert.equal(result.findings[0].subject.kind, "class-definition");
    assert.equal(result.findings[0].evidence[0].kind, "stylesheet");
    assert.equal(result.findings[0].traces[0].category, "rule-evaluation");
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class aggregates repeated definitions for the same class", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile(
      "src/Tag.css",
      [
        ".tag { display: inline-flex; }",
        "span.tag { cursor: default; }",
        "a.tag,",
        "button.tag { cursor: pointer; }",
        "a.tag:hover,",
        "button.tag:focus-visible { color: blue; }",
        ".tag--large { font-size: 1rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/Tag.css"],
    });
    const findings = result.findings.filter(
      (finding) => finding.ruleId === "unused-css-class" && finding.data?.className === "tag",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.definitionCount, 6);
    assert.deepEqual(findings[0].data?.definitionLocations, [
      {
        filePath: "src/Tag.css",
        startLine: 1,
        selectorText: ".tag",
      },
      {
        filePath: "src/Tag.css",
        startLine: 2,
        selectorText: "span.tag",
      },
      {
        filePath: "src/Tag.css",
        startLine: 3,
        selectorText: "a.tag",
      },
      {
        filePath: "src/Tag.css",
        startLine: 3,
        selectorText: "button.tag",
      },
      {
        filePath: "src/Tag.css",
        startLine: 5,
        selectorText: "a.tag:hover",
      },
      {
        filePath: "src/Tag.css",
        startLine: 5,
        selectorText: "button.tag:focus-visible",
      },
    ]);
    assert.match(findings[0].message, /defined 6 times/);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class does not report referenced classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="used">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".used { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats finite template literal variants through helpers as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'type ButtonVariant = "primary" | "ghost" | "ghost-round" | "destructive";',
        "type ButtonProps = { variant?: ButtonVariant; className?: string };",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function Button({ variant = 'primary', className }: ButtonProps) {",
        "  return <button className={joinClasses('button', `button--${variant}`, className)}>Save</button>;",
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
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "button--primary",
      "button--ghost",
      "button--ghost-round",
      "button--destructive",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats observed button helper class assembly as used", async () => {
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
        "  className?: string;",
        "};",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function Button({",
        "  variant = 'primary',",
        "  size = 'md',",
        "  iconOnly = false,",
        "  className,",
        "}: ButtonProps) {",
        "  const classes = joinClasses(",
        "    'button',",
        "    `button--${variant}`,",
        "    size === 'sm' && 'button--sm',",
        "    iconOnly && 'button--icon-only',",
        "    className,",
        "  );",
        "  return <button className={classes}>Save</button>;",
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
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats className forwarded through primitives as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Page.tsx",
      [
        'import "./Page.css";',
        'import { WorldMembersTableSection } from "./WorldMembersTableSection";',
        "export function Page() {",
        "  const members = [{ userId: '1', username: 'Ada', role: 'admin' }];",
        "  return (",
        "    <WorldMembersTableSection",
        "      filteredMembers={members}",
        "      sortedMembers={members}",
        '      query=""',
        "      setQuery={() => {}}",
        "      onRoleChange={() => {}}",
        "    />",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/WorldMembersTableSection.tsx",
      [
        'import { SearchBar } from "./SearchBar";',
        'import { Select } from "./Select";',
        'import { TableWrap } from "./TableWrap";',
        "export function WorldMembersTableSection({ filteredMembers, sortedMembers, query, setQuery, onRoleChange }) {",
        "  return (",
        '    <section className="world-members-page">',
        '      <SearchBar id="worldMembersSearch" name="worldMembersSearch" value={query}',
        '        placeholder="Search username or role..." onChange={setQuery}',
        '        className="world-members-page__search" />',
        '      <TableWrap className="world-members-page__table-wrap" stackedOnMobile>',
        '        <table className="world-members-page__table"><tbody>',
        "          {sortedMembers.map((member) => (",
        "            <tr key={member.userId}>",
        '              <td className="world-members-page__user-cell">{member.username}</td>',
        '              <td><Select className="world-members-page__role-select"',
        "                value={member.role}",
        "                onChange={(event) => onRoleChange(member.userId, event.target.value)} />",
        "              </td>",
        "            </tr>",
        "          ))}",
        "          {filteredMembers.length === 0 ? (",
        '            <tr><td className="world-members-page__empty">No members</td></tr>',
        "          ) : null}",
        "        </tbody></table>",
        "      </TableWrap>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/SearchBar.tsx",
      "export function SearchBar({ className, ...props }) { return <div className={['search-bar', className].filter(Boolean).join(' ')}><input {...props} className=\"search-bar__input\" /></div>; }\n",
    )
    .withSourceFile(
      "src/Select.tsx",
      "export function Select({ className, ...props }) { return <div className={['select', className].filter(Boolean).join(' ')}><select {...props} className=\"select__input\" /></div>; }\n",
    )
    .withSourceFile(
      "src/TableWrap.tsx",
      "export function TableWrap({ children, className, stackedOnMobile = false }) { return <div className={['app-table-wrap', stackedOnMobile ? 'app-table-wrap--stacked-mobile' : '', className ?? ''].filter(Boolean).join(' ')}>{children}</div>; }\n",
    )
    .withCssFile(
      "src/Page.css",
      [
        ".world-members-page { display: block; }",
        ".world-members-page__search { margin-block: 1rem; }",
        ".world-members-page__role-select { min-width: 12rem; }",
        ".world-members-page__table-wrap { overflow-x: auto; }",
        ".world-members-page__table { width: 100%; }",
        ".world-members-page__user-cell { font-weight: 600; }",
        ".world-members-page__empty { text-align: center; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "world-members-page__search",
      "world-members-page__role-select",
      "world-members-page__table-wrap",
      "world-members-page__user-cell",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats runtime DOM attributes object classes as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/RichTextEditor.tsx",
      [
        'import "./RichTextEditor.css";',
        "export function RichTextEditor({ mount, state }) {",
        "  new EditorView(",
        "    { mount },",
        "    {",
        "      state,",
        "      attributes: {",
        '        class: "lm-rich-text-editor__surface article-body ProseMirror",',
        '        spellcheck: "true",',
        "      },",
        "    },",
        "  );",
        '  return <div className="lm-rich-text-editor" />;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/RichTextEditor.css",
      [
        ".lm-rich-text-editor { display: block; }",
        ".lm-rich-text-editor__surface { min-height: 26rem; }",
        ".article-body { line-height: 1.6; }",
        ".ProseMirror { white-space: pre-wrap; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "lm-rich-text-editor__surface",
      "article-body",
      "ProseMirror",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class reports unreferenced local CSS linked by HTML", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/public/app.css">\n')
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile("public/app.css", ".unused { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "unused-css-class" && candidate.data?.className === "unused",
    );
    assert.ok(finding);
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

test("unused-css-class ignores local HTML-linked CSS that matches an external provider", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/vendor/font-awesome/6/css/all.css">\n')
    .withSourceFile("src/App.tsx", 'export function App() { return <i className="fa-check" />; }\n')
    .withCssFile(
      "vendor/font-awesome/6/css/all.css",
      ".fa-check { display: inline-block; }\n.fa-unused { display: inline-block; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "fa-unused",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class ignores unreferenced imported package CSS classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "library/styles.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withNodeModuleFile(
      "library/styles.css",
      ".library-btn { display: inline-flex; }\n.library-unused { display: none; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "library-unused",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class ignores unreferenced CSS-imported package classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", '@import "library/styles.css";\n')
    .withNodeModuleFile(
      "library/styles.css",
      ".library-btn { display: inline-flex; }\n.library-unused { display: none; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "library-unused",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class lowers confidence when dynamic class references exist", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .withCssFile("src/App.css", ".maybe-used { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const finding = result.findings.find((candidate) => candidate.ruleId === "unused-css-class");
    assert.equal(finding?.confidence, "medium");
  } finally {
    await project.cleanup();
  }
});
