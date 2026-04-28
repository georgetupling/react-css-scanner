import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { unusedCssClassRule } from "../../../dist/rules/rules/unusedCssClass.js";
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

test("unused-css-class explains classes only referenced in statically skipped branches", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        "  const unreadNotificationCount = 0;",
        "  const hasUnreadNotifications = unreadNotificationCount > 0;",
        "  return (",
        "    <button>",
        "      {hasUnreadNotifications ? (",
        '        <span className="notification-count">{unreadNotificationCount}</span>',
        "      ) : null}",
        "    </button>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".notification-count { min-width: 1rem; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });
    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "unused-css-class" &&
        candidate.data?.className === "notification-count",
    );

    assert.ok(finding);
    assert.match(finding.message, /only referenced in render branches/);
    assert.equal(finding.data?.usageReason, "only-in-statically-skipped-render-branches");
    assert.equal(
      finding.evidence.some((entry) => entry.kind === "statically-skipped-class-reference"),
      true,
    );
    assert.deepEqual(finding.data?.staticallySkippedReferenceLocations, [
      {
        filePath: "src/App.tsx",
        startLine: 7,
        rawExpressionText: '"notification-count"',
        conditionSourceText: "hasUnreadNotifications",
        skippedBranch: "when-true",
        reason: "condition-resolved-false",
      },
    ]);
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

test("unused-css-class treats matchable contextual selector subjects as used", () => {
  const context = buildUnusedClassRuleContext({
    outcome: "possible-match",
    status: "unsupported",
  });

  assert.deepEqual(unusedCssClassRule.run(context), []);
});

test("unused-css-class still reports contextual selector subjects with no bounded match", () => {
  const context = buildUnusedClassRuleContext({
    outcome: "no-match-under-bounded-analysis",
    status: "resolved",
  });

  const findings = unusedCssClassRule.run(context);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "unused-css-class");
  assert.equal(findings[0].data?.className, "popover__trigger");
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

test("unused-css-class treats className on unresolved components as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/SiteHeader.tsx",
      [
        'import { Link } from "react-router-dom";',
        'import "./SiteHeader.css";',
        'export function SiteHeader() { return <Link to="/" className="site-header__brand">Home</Link>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/SiteHeader.css", ".site-header__brand { font-weight: 700; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/SiteHeader.tsx"],
      cssFilePaths: ["src/SiteHeader.css"],
    });

    assertNoClassFindings(result, "unused-css-class", ["site-header__brand"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats subtree prop classes inside nullish fallback branches as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import { Slot } from "./Slot";',
        'import "./App.css";',
        "export function App() {",
        '  return <Slot content={<span className="slot-content">Ready</span>} />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Slot.tsx",
      [
        "export function Slot({ content }) {",
        '  return <section>{content ?? <span className="slot-fallback">Fallback</span>}</section>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      ".slot-content { display: inline-flex; }\n.slot-fallback { display: none; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/Slot.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assertNoClassFindings(result, "unused-css-class", ["slot-content", "slot-fallback"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats helper-forwarded class props as used across component boundaries", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import { Dropdown } from "./Dropdown";',
        'import "./App.css";',
        "export function App() {",
        '  return <Dropdown className="site-header__notifications-menu" triggerClassName="site-header__menu-trigger site-header__menu-trigger--round" />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Dropdown.tsx",
      [
        'import { Popover } from "./Popover";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Dropdown({ className, triggerClassName }) {",
        "  return (",
        "    <Popover",
        "      className={joinClasses('dropdown-menu', className)}",
        "      triggerClassName={triggerClassName}",
        "    />",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Popover.tsx",
      [
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Popover({ className, triggerClassName }) {",
        "  return (",
        "    <div className={joinClasses('popover', className)}>",
        "      <button className={joinClasses('popover__trigger', triggerClassName)} />",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [
        ".site-header__notifications-menu { display: block; }",
        ".site-header__menu-trigger { display: inline-flex; }",
        ".site-header__menu-trigger--round { border-radius: 999px; }",
        ".dropdown-menu { display: contents; }",
        ".popover { position: relative; }",
        ".popover__trigger { display: inline-flex; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/Dropdown.tsx", "src/Popover.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assertNoClassFindings(result, "unused-css-class", [
      "site-header__notifications-menu",
      "site-header__menu-trigger",
      "site-header__menu-trigger--round",
      "dropdown-menu",
      "popover",
      "popover__trigger",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats helper-forwarded class props as used through local helper aliases", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/HomePage.tsx",
      [
        'import { Button } from "../ui/Button";',
        'import "./HomePage.css";',
        'export function HomePage() { return <Button className="home-page__cta" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/ui/Button.tsx",
      [
        'import "./Button.css";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function Button({ className }) {",
        "  const cx = joinClasses;",
        "  return <button className={cx('button', className)}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/pages/HomePage.css", ".home-page__cta { width: 100%; }\n")
    .withCssFile("src/ui/Button.css", ".button { display: inline-flex; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["home-page__cta"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats data-driven object literal class values in array maps as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/HomePageGuestView.tsx",
      [
        'import "./HomePageGuestView.css";',
        "const howItWorksItems = [",
        "  { title: 'Create worlds', graphicClassName: 'home-page__how-it-works-graphic--world' },",
        "  { title: 'Collaborate safely', graphicClassName: 'home-page__how-it-works-graphic--collaborate' },",
        "  { title: 'Track canon', graphicClassName: 'home-page__how-it-works-graphic--control' },",
        "  { title: 'Host beautifully', graphicClassName: 'home-page__how-it-works-graphic--hosted' },",
        "];",
        "export function HomePageGuestView() {",
        "  return (",
        '    <div className="home-page__how-it-works-grid">',
        "      {howItWorksItems.map((item) => (",
        '        <article className="home-page__how-it-works-card" key={item.title}>',
        "          <div",
        "            className={`home-page__how-it-works-graphic ${item.graphicClassName}`}",
        '            aria-hidden="true"',
        "          />",
        "        </article>",
        "      ))}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/HomePageGuestView.css",
      [
        ".home-page__how-it-works-graphic { display: block; }",
        ".home-page__how-it-works-graphic--world { color: green; }",
        ".home-page__how-it-works-graphic--collaborate { color: blue; }",
        ".home-page__how-it-works-graphic--control { color: purple; }",
        ".home-page__how-it-works-graphic--hosted { color: gold; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "home-page__how-it-works-graphic--world",
      "home-page__how-it-works-graphic--collaborate",
      "home-page__how-it-works-graphic--control",
      "home-page__how-it-works-graphic--hosted",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats finite role template literal class variants as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/MemberRoleBadge.tsx",
      [
        'import "./MemberRoleBadge.css";',
        'type MemberRole = "owner" | "editor" | "reader";',
        "type MemberRoleBadgeProps = { role: MemberRole };",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function MemberRoleBadge({ role }: MemberRoleBadgeProps) {",
        "  return <span className={joinClasses('member-role-badge', `member-role-badge--${role}`)} />;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/MemberRoleBadge.css",
      [
        ".member-role-badge { display: inline-flex; }",
        ".member-role-badge--owner { color: red; }",
        ".member-role-badge--editor { color: blue; }",
        ".member-role-badge--reader { color: green; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "member-role-badge--owner",
      "member-role-badge--editor",
      "member-role-badge--reader",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants through imported const-derived tuple aliases", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/domain.ts",
      [
        "export const WORLD_ROLES = ['owner', 'editor', 'reader'] as const;",
        "export type WorldRole = (typeof WORLD_ROLES)[number];",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/api-contracts.ts",
      [
        'import type { WorldRole } from "./domain";',
        "export type WorldMemberRole = WorldRole;",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/MemberRoleBadge.tsx",
      [
        'import type { WorldMemberRole } from "./api-contracts";',
        'import "./MemberRoleBadge.css";',
        "type MemberRoleBadgeProps = { role: WorldMemberRole };",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function MemberRoleBadge({ role }: MemberRoleBadgeProps) {",
        "  return <span className={joinClasses('member-role-badge', `member-role-badge--${role}`)} />;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/MemberRoleBadge.css",
      [
        ".member-role-badge { display: inline-flex; }",
        ".member-role-badge--owner { color: red; }",
        ".member-role-badge--editor { color: blue; }",
        ".member-role-badge--reader { color: green; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "member-role-badge--owner",
      "member-role-badge--editor",
      "member-role-badge--reader",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves const-derived variants through workspace package barrels", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "packages/@loremaster/domain/src/index.ts",
      ['export * from "./worlds.enums.js";', ""].join("\n"),
    )
    .withSourceFile(
      "packages/@loremaster/domain/src/worlds.enums.ts",
      [
        "export const WORLD_ROLES = ['owner', 'editor', 'reader'] as const;",
        "export type WorldRole = (typeof WORLD_ROLES)[number];",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "packages/@loremaster/api-contracts/src/index.ts",
      ['export * from "./worlds/world-members.contract.js";', ""].join("\n"),
    )
    .withSourceFile(
      "packages/@loremaster/api-contracts/src/worlds/world-members.contract.ts",
      [
        'import type { WorldRole } from "@loremaster/domain";',
        "export type WorldMemberRole = WorldRole;",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/MemberRoleBadge.tsx",
      [
        'import type { WorldMemberRole } from "@loremaster/api-contracts";',
        'import "./MemberRoleBadge.css";',
        "type MemberRoleBadgeProps = { role: WorldMemberRole };",
        "export function MemberRoleBadge({ role }: MemberRoleBadgeProps) {",
        "  return <span className={`member-role-badge member-role-badge--${role}`} />;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/MemberRoleBadge.css",
      [
        ".member-role-badge { display: inline-flex; }",
        ".member-role-badge--owner { color: red; }",
        ".member-role-badge--editor { color: blue; }",
        ".member-role-badge--reader { color: green; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "member-role-badge--owner",
      "member-role-badge--editor",
      "member-role-badge--reader",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats computed shared primitive base classes as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/PageState.tsx",
      [
        'import "./PageState.css";',
        "type PageStateProps = { title: string; message: string; className?: string };",
        "export function PageState({ title, message, className }: PageStateProps) {",
        "  const rootClassName = className ? `page-state ${className}` : 'page-state';",
        "  return (",
        "    <div className={rootClassName}>",
        '      <h1 className="page-state__title">{title}</h1>',
        '      <p className="page-state__message">{message}</p>',
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/PageState.css",
      [
        ".page-state { display: grid; }",
        ".page-state__title { font-weight: 700; }",
        ".page-state__message { color: currentColor; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "page-state",
      "page-state__title",
      "page-state__message",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class preserves local class aliases declared inside mapped render callback bodies", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/DesktopPublicWorldPanel.tsx",
      [
        'import { HomepageDiscoveryCard } from "./HomepageDiscoveryCard";',
        'import "./DesktopPublicWorldPanel.css";',
        "export function DesktopPublicWorldPanel({ discovery }) {",
        "  const safeActiveDiscoveryIndex = 0;",
        "  const previousDiscoveryIndex = 1;",
        "  const nextDiscoveryIndex = 2;",
        "  return (",
        '    <div className="home-page__discovery-stage">',
        "      {discovery.slots.map((slot, index) => {",
        "        const isActive = index === safeActiveDiscoveryIndex;",
        "        const isPrevious = index === previousDiscoveryIndex;",
        "        const isNext = index === nextDiscoveryIndex;",
        "        const cardPositionClass = isActive",
        "          ? 'home-page__discovery-card--active'",
        "          : isPrevious",
        "            ? 'home-page__discovery-card--previous'",
        "            : isNext",
        "              ? 'home-page__discovery-card--next'",
        "              : 'home-page__discovery-card--hidden';",
        "        return <HomepageDiscoveryCard slot={slot} className={cardPositionClass} />;",
        "      })}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/HomepageDiscoveryCard.tsx",
      [
        'import "./HomepageDiscoveryCard.css";',
        "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
        "export function HomepageDiscoveryCard({ className }) {",
        "  return <a className={joinClasses('home-page__discovery-card', className)} />;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/DesktopPublicWorldPanel.css",
      [
        ".home-page__discovery-card--active { opacity: 1; }",
        ".home-page__discovery-card--previous { opacity: 0.8; }",
        ".home-page__discovery-card--next { opacity: 0.8; }",
        ".home-page__discovery-card--hidden { opacity: 0; }",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/HomepageDiscoveryCard.css",
      ".home-page__discovery-card { display: block; }\n",
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "home-page__discovery-card--active",
      "home-page__discovery-card--previous",
      "home-page__discovery-card--next",
      "home-page__discovery-card--hidden",
    ]);
  } finally {
    await project.cleanup();
  }
});

test(
  "unused-css-class should scan JSX literals passed into side-effect setters",
  {
    skip: "known gap: render extraction currently starts at returned JSX and render props/children",
  },
  async () => {
    const project = await new TestProjectBuilder()
      .withSourceFile(
        "src/WorldLayout.tsx",
        [
          'import "./WorldLayout.css";',
          "function useAppChrome() { return { setTopBar(_node) {} }; }",
          "export function WorldLayout() {",
          "  const { setTopBar } = useAppChrome();",
          "  setTopBar(",
          '    <section className="world-layout__subnav-shell">',
          '      <div className="world-layout__subnav-shell-inner" />',
          "    </section>,",
          "  );",
          "  return null;",
          "}",
          "",
        ].join("\n"),
      )
      .withCssFile(
        "src/WorldLayout.css",
        [
          ".world-layout__subnav-shell { display: block; }",
          ".world-layout__subnav-shell-inner { max-width: 80rem; }",
          "",
        ].join("\n"),
      )
      .build();

    try {
      const result = await scanProject({ rootDir: project.rootDir });

      assertNoClassFindings(result, "unused-css-class", [
        "world-layout__subnav-shell",
        "world-layout__subnav-shell-inner",
      ]);
    } finally {
      await project.cleanup();
    }
  },
);

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

test("unused-css-class treats props-object destructured finite variants as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'type ButtonVariant = "primary" | "ghost" | "ghost-round" | "destructive";',
        'type ButtonSize = "md" | "sm";',
        "type ButtonBaseProps = {",
        "  variant?: ButtonVariant;",
        "  size?: ButtonSize;",
        "  className?: string;",
        "  iconOnly?: boolean;",
        "};",
        'type ButtonAsButtonProps = ButtonBaseProps & { to?: undefined; type?: "button" | "submit" };',
        "type ButtonAsLinkProps = ButtonBaseProps & { to: string; replace?: boolean };",
        "type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;",
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function Button(props: ButtonProps) {",
        "  const {",
        "    variant = 'primary',",
        "    size = 'md',",
        "    className,",
        "    iconOnly = false,",
        "  } = props;",
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

test("unused-css-class treats finite classes returned from typed destructured helpers as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Tag.tsx",
      [
        'import "./Tag.css";',
        'type TagVariant = "default" | "genre" | "article-type" | "topic" | "featured";',
        'type TagSize = "sm" | "md" | "lg";',
        "type TagBaseProps = {",
        "  children?: unknown;",
        "  variant?: TagVariant;",
        "  size?: TagSize;",
        "  className?: string;",
        "};",
        "function getTagClassName({",
        "  variant = 'default',",
        "  size = 'md',",
        "  className,",
        "}: Omit<TagBaseProps, 'children'>) {",
        "  return [",
        "    'tag',",
        "    size === 'sm' ? 'tag--small' : '',",
        "    size === 'lg' ? 'tag--large' : '',",
        "    variant !== 'default' ? `tag--${variant}` : '',",
        "    className ?? '',",
        "  ].filter(Boolean).join(' ');",
        "}",
        "export function Tag({ children, variant, size, className }: TagBaseProps) {",
        "  return <span className={getTagClassName({ variant, size, className })}>{children}</span>;",
        "}",
        "export function TagDismissButton({ variant, size, className }: TagBaseProps) {",
        "  return <button className={getTagClassName({",
        "    variant,",
        "    size,",
        "    className: ['tag--dismissible', className].filter(Boolean).join(' '),",
        "  })}>Dismiss</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Tag.css",
      [
        ".tag { display: inline-flex; }",
        ".tag--genre { color: green; }",
        ".tag--article-type { color: blue; }",
        ".tag--topic { color: purple; }",
        ".tag--featured { color: gold; }",
        ".tag--small { min-height: 1rem; }",
        ".tag--large { min-height: 2rem; }",
        ".tag--dismissible { gap: 0.5rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "tag",
      "tag--article-type",
      "tag--dismissible",
      "tag--featured",
      "tag--genre",
      "tag--large",
      "tag--small",
      "tag--topic",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class preserves finite helper evidence through helper body destructuring", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Badge.tsx",
      [
        'import "./Badge.css";',
        'type BadgeTone = "info" | "success";',
        "type BadgeProps = { tone?: BadgeTone; className?: string };",
        "function getBadgeClassName(props: BadgeProps) {",
        "  const { tone = 'info', className } = props;",
        "  return ['badge', `badge--${tone}`, className ?? ''].filter(Boolean).join(' ');",
        "}",
        "export function Badge({ tone, className }: BadgeProps) {",
        "  return <span className={getBadgeClassName({ tone, className })}>Badge</span>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Badge.css",
      [
        ".badge { display: inline-flex; }",
        ".badge--info { color: blue; }",
        ".badge--success { color: green; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["badge", "badge--info", "badge--success"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats caller classes forwarded through props-object destructuring as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/BrowsePage.tsx",
      [
        'import { Button } from "../ui/Button";',
        'import "./BrowseControls.css";',
        'export function BrowsePage() { return <Button className="browse-toolbar-button" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/ui/Button.tsx",
      [
        'import "./Button.css";',
        "function joinClasses(...classes: Array<string | false | null | undefined>) {",
        "  return classes.filter(Boolean).join(' ');",
        "}",
        "export function Button(props: { className?: string; variant?: string }) {",
        "  const { className, variant = 'primary' } = props;",
        "  const classes = joinClasses('button', `button--${variant}`, className);",
        "  return <button className={classes}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/pages/BrowseControls.css", ".browse-toolbar-button { width: 100%; }\n")
    .withCssFile("src/ui/Button.css", ".button { display: inline-flex; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["browse-toolbar-button"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats switch-helper classes in filtered arrays as used", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/TriStateFilterChip.tsx",
      [
        'import "./BrowseControls.css";',
        "function getTriStateFilterChipClassName(state: 'require' | 'exclude' | 'neutral') {",
        "  switch (state) {",
        '    case "require": return "browse-filter-chip browse-filter-chip--require";',
        '    case "exclude": return "browse-filter-chip browse-filter-chip--exclude";',
        '    default: return "browse-filter-chip";',
        "  }",
        "}",
        "export function TriStateFilterChip({ state, className }: { state: 'require' | 'exclude' | 'neutral'; className?: string }) {",
        '  return <button className={[getTriStateFilterChipClassName(state), className].filter(Boolean).join(" ")} />;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/BrowseControls.css",
      [
        ".browse-filter-chip { display: inline-flex; }",
        ".browse-filter-chip--require { color: green; }",
        ".browse-filter-chip--exclude { color: red; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "browse-filter-chip",
      "browse-filter-chip--require",
      "browse-filter-chip--exclude",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants from local interfaces and indexed access", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Badge.tsx",
      [
        'import "./Badge.css";',
        'type BadgeTone = "info" | "success";',
        "interface BadgeBaseProps {",
        "  tone?: BadgeTone;",
        "}",
        "interface BadgeProps extends BadgeBaseProps {",
        '  size?: "sm" | "lg";',
        "}",
        'type ResolvedTone = NonNullable<BadgeProps["tone"]>;',
        'type ResolvedSize = BadgeProps["size"];',
        "type PublicBadgeProps = { tone?: ResolvedTone; size?: ResolvedSize };",
        "export function Badge({ tone = 'info', size = 'sm' }: PublicBadgeProps) {",
        "  return <span className={[`badge--${tone}`, `badge--${size}`].join(' ')}>Badge</span>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Badge.css",
      [
        ".badge--info { color: blue; }",
        ".badge--success { color: green; }",
        ".badge--sm { font-size: 0.75rem; }",
        ".badge--lg { font-size: 1rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "badge--info",
      "badge--success",
      "badge--sm",
      "badge--lg",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants through local object utility types", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Tag.tsx",
      [
        'import "./Tag.css";',
        "interface TagProps {",
        '  variant?: "genre" | "topic";',
        '  size?: "sm" | "lg";',
        "  className?: string;",
        "  children?: unknown;",
        "}",
        'type HelperProps = Readonly<Required<Partial<Omit<Pick<TagProps, "variant" | "size" | "className" | "children">, "children" | "className">>>>;',
        "function getTagClassName({ variant = 'genre', size = 'sm' }: HelperProps) {",
        "  return [`tag--${variant}`, `tag--${size}`].join(' ');",
        "}",
        "export function Tag({ variant, size }: TagProps) {",
        "  return <span className={getTagClassName({ variant, size })}>Tag</span>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Tag.css",
      [
        ".tag--genre { color: green; }",
        ".tag--topic { color: purple; }",
        ".tag--sm { min-height: 1rem; }",
        ".tag--lg { min-height: 2rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "tag--genre",
      "tag--topic",
      "tag--sm",
      "tag--lg",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants through local union utility types", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'type ButtonVariant = "default" | "primary" | "ghost";',
        'type ActionVariant = Exclude<ButtonVariant, "default">;',
        'type QuietVariant = Extract<ButtonVariant, "ghost" | "link">;',
        "type ButtonProps = { variant?: ActionVariant; quiet?: QuietVariant };",
        "export function Button({ variant = 'primary', quiet = 'ghost' }: ButtonProps) {",
        "  return <button className={[`button--${variant}`, `button--${quiet}`].join(' ')}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [".button--primary { color: white; }", ".button--ghost { color: inherit; }", ""].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["button--primary", "button--ghost"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants from imported type aliases and props aliases", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/types.ts",
      [
        'export type TagVariant = "genre" | "topic";',
        "export type TagProps = { variant?: TagVariant };",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Tag.tsx",
      [
        'import "./Tag.css";',
        'import type { TagProps, TagVariant as ImportedVariant } from "./types";',
        "type LocalProps = TagProps & { tone?: ImportedVariant };",
        "export function Tag({ variant = 'genre', tone = 'topic' }: LocalProps) {",
        "  return <span className={[`tag--${variant}`, `tag--${tone}`].join(' ')}>Tag</span>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Tag.css",
      [".tag--genre { color: green; }", ".tag--topic { color: purple; }", ""].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["tag--genre", "tag--topic"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants from imported interfaces and re-export barrels", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/types.ts",
      [
        'export type ButtonVariant = "primary" | "ghost";',
        "export interface ButtonBaseProps {",
        "  variant?: ButtonVariant;",
        "}",
        "export interface ButtonProps extends ButtonBaseProps {",
        '  size?: "sm" | "lg";',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/barrel.ts",
      [
        'export type { ButtonProps, ButtonVariant as ExportedVariant } from "./types";',
        'export { type ButtonProps as AliasedButtonProps } from "./types";',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'import type { AliasedButtonProps, ExportedVariant } from "./barrel";',
        'import type { ButtonProps as DirectButtonProps } from "./types";',
        'type PublicButtonProps = Pick<AliasedButtonProps, "variant" | "size"> & { tone?: ExportedVariant };',
        'function getVariantClassName({ variant = "primary" }: Pick<DirectButtonProps, "variant">) {',
        "  return `button--${variant}`;",
        "}",
        "export function Button({ variant = 'primary', size = 'sm', tone = 'ghost' }: PublicButtonProps) {",
        "  return <button className={[getVariantClassName({ variant }), `button--${size}`, `button--${tone}`].join(' ')}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [
        ".button--primary { color: white; }",
        ".button--ghost { color: inherit; }",
        ".button--sm { min-height: 2rem; }",
        ".button--lg { min-height: 3rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", [
      "button--primary",
      "button--ghost",
      "button--sm",
      "button--lg",
    ]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants from tsconfig path aliases", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            baseUrl: ".",
            paths: {
              "@app-types/*": ["src/types/*"],
            },
          },
        },
        null,
        2,
      ),
    )
    .withSourceFile(
      "src/types/button.ts",
      [
        'export type ButtonTone = "primary" | "ghost";',
        "export interface ButtonProps {",
        "  tone?: ButtonTone;",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'import type { ButtonTone } from "@app-types/button";',
        "type ButtonProps = { tone?: ButtonTone };",
        "export function Button({ tone = 'primary' }: ButtonProps) {",
        "  return <button className={`button--${tone}`}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [".button--primary { color: white; }", ".button--ghost { color: inherit; }", ""].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "unused-css-class", ["button--primary", "button--ghost"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class resolves finite variants from package exports", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
        },
        null,
        2,
      ),
    )
    .withFile(
      "node_modules/design-system/package.json",
      JSON.stringify({
        name: "design-system",
        type: "module",
        exports: {
          "./button": "./src/button.ts",
        },
      }),
    )
    .withSourceFile(
      "node_modules/design-system/src/button.ts",
      [
        'export type ButtonTone = "primary" | "ghost";',
        "export interface ButtonProps {",
        "  tone?: ButtonTone;",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Button.tsx",
      [
        'import "./Button.css";',
        'import type { ButtonTone } from "design-system/button";',
        "type ButtonProps = { tone?: ButtonTone };",
        "export function Button({ tone = 'primary' }: ButtonProps) {",
        "  return <button className={`button--${tone}`}>Save</button>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Button.css",
      [".button--primary { color: white; }", ".button--ghost { color: inherit; }", ""].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/Button.tsx", "node_modules/design-system/src/button.ts"],
    });

    assertNoClassFindings(result, "unused-css-class", ["button--primary", "button--ghost"]);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class degrades imported type cycles without crashing", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/a.ts",
      ['import type { PropsB } from "./b";', "export type PropsA = PropsB;"].join("\n"),
    )
    .withSourceFile(
      "src/b.ts",
      ['import type { PropsA } from "./a";', "export type PropsB = PropsA;"].join("\n"),
    )
    .withSourceFile(
      "src/Cycle.tsx",
      [
        'import "./Cycle.css";',
        'import type { PropsA } from "./a";',
        "export function Cycle({ variant }: PropsA) {",
        "  return <span className={`cycle--${variant}`}>Cycle</span>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Cycle.css", ".cycle--primary { color: blue; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assert.ok(Array.isArray(result.findings));
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class treats static JSX classes inside assigned conditional content as used", async () => {
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

test("unused-css-class treats full button helper variant assembly as used", async () => {
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

test("unused-css-class treats static classes inside cloneElement field children as used", async () => {
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

test("unused-css-class indexes cloneElement className replacement classes", async () => {
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

test("unused-css-class preserves child class evidence through cloneElement className merges", async () => {
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

test("unused-css-class preserves mapped child classes through Children.map cloneElement transforms", async () => {
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

test("unused-css-class keeps shadowed callback children identifiers distinct from component children", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/FieldList.tsx",
      [
        'import { Children } from "react";',
        'import "./FieldList.css";',
        "export function FieldList({ children }) {",
        "  return <div>{Children.map([1], (children) => children)}</div>;",
        "}",
        "export function App() {",
        "  return (",
        "    <FieldList>",
        '      <span className="field-list__slot" />',
        "    </FieldList>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/FieldList.css", [".field-list__slot { display: block; }", ""].join("\n"))
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assert.deepEqual(
      result.findings
        .filter(
          (finding) =>
            finding.ruleId === "unused-css-class" && finding.data?.className === "field-list__slot",
        )
        .map((finding) => finding.data?.className),
      ["field-list__slot"],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class preserves mapped child classes through Children.toArray map cloneElement transforms", async () => {
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

function buildUnusedClassRuleContext({ outcome, status }) {
  const stylesheetId = "stylesheet:src/BrowseControls.css";
  const definitionId = "class-definition:popover__trigger";
  const selectorBranchId = "selector-branch:popover__trigger";
  const selectorQueryId = "selector-query:popover__trigger";
  const selectorText = ".browse-toolbar-group .popover__trigger";

  const definition = {
    id: definitionId,
    stylesheetId,
    className: "popover__trigger",
    selectorText,
    selectorKind: "contextual",
    line: 4,
    atRuleContext: [],
    declarationProperties: ["color"],
    declarationSignature: "color",
    isCssModule: false,
    sourceDefinition: {
      className: "popover__trigger",
      selector: selectorText,
      selectorBranch: {
        raw: selectorText,
        matchKind: "contextual",
        subjectClassNames: ["popover__trigger"],
        requiredClassNames: ["browse-toolbar-group", "popover__trigger"],
        contextClassNames: ["browse-toolbar-group"],
        negativeClassNames: [],
        hasCombinators: true,
        hasSubjectModifiers: false,
        hasUnknownSemantics: false,
      },
      declarations: ["color"],
      declarationDetails: [{ property: "color", value: "red" }],
      line: 4,
      atRuleContext: [],
    },
  };
  const branch = {
    id: selectorBranchId,
    selectorQueryId,
    selectorText,
    selectorListText: selectorText,
    branchIndex: 0,
    branchCount: 1,
    ruleKey: `${stylesheetId}:4:${selectorText}`,
    location: {
      filePath: "C:\\repo\\src\\BrowseControls.css",
      startLine: 6,
      startColumn: 1,
    },
    constraint: {
      kind: "ancestor-descendant",
      ancestorClassName: "browse-toolbar-group",
      subjectClassName: "popover__trigger",
    },
    outcome,
    status,
    confidence: status === "resolved" ? "high" : "medium",
    traces: [],
    sourceQuery: {
      id: selectorQueryId,
      stylesheetId,
      selectorText,
      location: {
        filePath: "C:\\repo\\src\\BrowseControls.css",
        startLine: 6,
        startColumn: 1,
      },
      outcome,
      status,
      confidence: status === "resolved" ? "high" : "medium",
      traces: [],
      sourceResult: {
        selectorText,
        outcome,
        status,
        confidence: status === "resolved" ? "high" : "medium",
        reasons: [],
        traces: [],
      },
    },
  };
  const indexedUnrelatedBranch = {
    ...branch,
    id: "selector-branch:unrelated",
    selectorText: ".other",
    outcome: "no-match-under-bounded-analysis",
    status: "resolved",
  };

  return {
    includeTraces: false,
    analysis: {
      entities: {
        classDefinitions: [definition],
        classReferences: [],
        selectorBranches: [indexedUnrelatedBranch, branch],
      },
      indexes: {
        referencesByClassName: new Map(),
        stylesheetsById: new Map([
          [
            stylesheetId,
            {
              id: stylesheetId,
              origin: "project",
              filePath: "src/BrowseControls.css",
            },
          ],
        ]),
        selectorBranchesByStylesheetId: new Map([[stylesheetId, [indexedUnrelatedBranch.id]]]),
        selectorBranchesById: new Map([
          [selectorBranchId, branch],
          [indexedUnrelatedBranch.id, indexedUnrelatedBranch],
        ]),
      },
      relations: {
        stylesheetReachability: [],
      },
    },
  };
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
