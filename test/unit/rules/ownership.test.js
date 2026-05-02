import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("single-component-style-not-colocated reports one-component styles outside supported colocation", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/button.css", ".button { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx"],
      cssFilePaths: ["src/styles/button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "single-component-style-not-colocated",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
    assert.equal(findings[0].subject.kind, "class-definition");
    assert.equal(findings[0].evidence[0].kind, "component");
    assert.equal(findings[0].data?.className, "button");
    assert.equal(findings[0].data?.componentName, "Button");
    assert.equal(findings[0].data?.stylesheetFilePath, "src/styles/button.css");
  } finally {
    await project.cleanup();
  }
});

test("single-component-style-not-colocated consolidates repeated definitions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/styles/button.css",
      [
        ".button { display: block; }",
        "@media (min-width: 40rem) {",
        "  .button { gap: 0.5rem; }",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx"],
      cssFilePaths: ["src/styles/button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "single-component-style-not-colocated",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "button");
    assert.equal(findings[0].data?.definitionCount, 2);
    assert.equal(Array.isArray(findings[0].data?.definitionLocations), true);
    assert.match(findings[0].message, /defined in 2 matching selector blocks/);
  } finally {
    await project.cleanup();
  }
});

test("single-component-style-not-colocated does not report colocated sibling styles", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button.css", ".button { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx"],
      cssFilePaths: ["src/components/Button.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) => finding.ruleId === "single-component-style-not-colocated",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner reports classes consumed outside a private component stylesheet", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import { Button } from "./Button/Button";',
        'export function Card() { return <div><Button /><span className="button">Again</span></div>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button/Button.css", ".button { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/components/Button/Button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-used-outside-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].confidence, "high");
    assert.equal(findings[0].subject.kind, "class-definition");
    assert.equal(findings[0].data?.className, "button");
    assert.equal(findings[0].data?.ownerComponentName, "Button");
    assert.equal(findings[0].data?.consumerComponentName, "Card");
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner still reports leaked private BEM-like classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button__label">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import { Button } from "./Button/Button";',
        'export function Card() { return <div><Button /><span className="button__label">Again</span></div>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button/Button.css", ".button__label { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/components/Button/Button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-used-outside-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "button__label");
    assert.equal(findings[0].data?.ownerComponentName, "Button");
    assert.equal(findings[0].data?.consumerComponentName, "Card");
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner still reports contextual classes from the owner block", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/SiteHeader/SiteHeader.tsx",
      [
        'import "./SiteHeader.css";',
        "export function SiteHeader() {",
        '  return <nav className="site-header"><div className="site-header__account-menu" /></nav>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/profile/ProfileMenu.tsx",
      [
        "export function ProfileMenu() {",
        '  return <div className="site-header__popover-panel">Profile</div>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/components/SiteHeader/SiteHeader.css",
      ".site-header__account-menu .site-header__popover-panel { display: block; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: [
        "src/components/SiteHeader/SiteHeader.tsx",
        "src/features/profile/ProfileMenu.tsx",
      ],
      cssFilePaths: ["src/components/SiteHeader/SiteHeader.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-used-outside-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "site-header__popover-panel");
    assert.equal(findings[0].data?.ownerComponentName, "SiteHeader");
    assert.equal(findings[0].data?.consumerComponentName, "ProfileMenu");
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner does not treat single importer alone as private ownership", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import { Button } from "./Button";',
        'export function Card() { return <div><Button /><span className="button">Again</span></div>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/button.css", ".button { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/styles/button.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner attributes child component classes to the child, not the parent render root", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/HomePage.tsx",
      [
        'import { GuestLogin } from "../features/auth/GuestLogin";',
        "export function HomePage() { return <main><GuestLogin /></main>; }",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/auth/GuestLogin.tsx",
      [
        'import "./GuestLogin.css";',
        'export function GuestLogin() { return <section className="guest-login">Sign in</section>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/features/auth/GuestLogin.css", ".guest-login { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/pages/HomePage.tsx", "src/features/auth/GuestLogin.tsx"],
      cssFilePaths: ["src/features/auth/GuestLogin.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
    assert.deepEqual(
      result.findings
        .filter((finding) => finding.ruleId === "single-component-style-not-colocated")
        .map((finding) => finding.data?.componentName),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner attributes forwarded class props to the supplying component", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/MembersPage.tsx",
      [
        'import "./MembersPage.css";',
        'import { Select } from "../components/Select";',
        'export function MembersPage() { return <Select className="members-page__select" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Select.tsx",
      "export function Select({ className }) { return <div className={className} />; }\n",
    )
    .withCssFile("src/pages/MembersPage.css", ".members-page__select { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/pages/MembersPage.tsx", "src/components/Select.tsx"],
      cssFilePaths: ["src/pages/MembersPage.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner attributes custom forwarded class props to the supplying component", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/GalleryPage.tsx",
      [
        'import "./GalleryPage.css";',
        'import { Modal } from "../components/Modal";',
        'export function GalleryPage() { return <Modal bodyClassName="gallery-page__body" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Modal.tsx",
      "export function Modal({ bodyClassName }) { return <section className={bodyClassName} />; }\n",
    )
    .withCssFile("src/pages/GalleryPage.css", ".gallery-page__body { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/pages/GalleryPage.tsx", "src/components/Modal.tsx"],
      cssFilePaths: ["src/pages/GalleryPage.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner attributes merged forwarded class props to the supplying component", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/MembersPage.tsx",
      [
        'import "./MembersPage.css";',
        'import { Select } from "../components/Select";',
        'export function MembersPage() { return <Select className="members-page__select" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Select.tsx",
      [
        'import "./Select.css";',
        'export function Select({ className }) { return <div className={["select", className].join(" ")} />; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/pages/MembersPage.css", ".members-page__select { display: block; }\n")
    .withCssFile("src/components/Select.css", ".select { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/pages/MembersPage.tsx", "src/components/Select.tsx"],
      cssFilePaths: ["src/pages/MembersPage.css", "src/components/Select.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner attributes helper-merged forwarded class props to the supplying component", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/MembersPage.tsx",
      [
        'import "./MembersPage.css";',
        'import { Select } from "../components/Select";',
        'export function MembersPage() { return <Select className="members-page__select" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Select.tsx",
      [
        'import "./Select.css";',
        'function joinClasses(...classes) { return classes.filter(Boolean).join(" "); }',
        'export function Select({ className }) { return <div className={joinClasses("select", className)} />; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/pages/MembersPage.css", ".members-page__select { display: block; }\n")
    .withCssFile("src/components/Select.css", ".select { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/pages/MembersPage.tsx", "src/components/Select.tsx"],
      cssFilePaths: ["src/pages/MembersPage.css", "src/components/Select.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner does not report without a single importing component owner", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import "../styles/button.css";',
        'export function Card() { return <span className="button">Again</span>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/button.css", ".button { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/styles/button.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner does not report intentionally broad stylesheets", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./styles/global.css";',
        'import { Card } from "./components/Card";',
        "export function App() { return <main><Card /></main>; }",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      ['export function Card() { return <span className="shell">Again</span>; }', ""].join("\n"),
    )
    .withCssFile("src/styles/global.css", ".shell { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/styles/global.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-used-outside-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner ignores same-family sibling skeleton components", async () => {
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

test("style-used-outside-owner ignores scoped primitive override classes", async () => {
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

test("style-used-outside-owner ignores generic state class tokens", async () => {
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

test("style-used-outside-owner reports private owner leaks even when the path looks broad", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Layout/Layout.tsx",
      [
        'import "./Layout.css";',
        'export function Layout() { return <main className="layout">Content</main>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import { Layout } from "./Layout/Layout";',
        'export function Card() { return <div><Layout /><span className="layout">Again</span></div>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Layout/Layout.css", ".layout { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-used-outside-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "layout");
    assert.equal(findings[0].data?.ownerComponentName, "Layout");
  } finally {
    await project.cleanup();
  }
});

test("style-used-outside-owner consolidates outside consumers and repeated definitions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import { Button } from "./Button/Button";',
        'export function Card() { return <div><Button /><span className="button">Again</span></div>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Dialog.tsx",
      [
        'import { Button } from "./Button/Button";',
        'export function Dialog() { return <section><Button /><span className="button">Again</span></section>; }',
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/components/Button/Button.css",
      [
        ".button { display: block; }",
        "@media (min-width: 40rem) {",
        "  .button { gap: 0.5rem; }",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: [
        "src/components/Button/Button.tsx",
        "src/components/Card.tsx",
        "src/components/Dialog.tsx",
      ],
      cssFilePaths: ["src/components/Button/Button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-used-outside-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "button");
    assert.equal(findings[0].data?.outsideConsumerComponentCount, 2);
    assert.deepEqual(findings[0].data?.outsideConsumerComponentNames, ["Card", "Dialog"]);
    assert.equal(findings[0].data?.definitionCount, 2);
    assert.match(findings[0].message, /used outside that owner by 2 components: Card, Dialog/);
    assert.match(findings[0].message, /defined in 2 matching selector blocks/);
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner reports multi-component styles without broad owner evidence", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="surface">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card/Card.tsx",
      [
        'import "../Button/Button.css";',
        'export function Card() { return <article className="surface">Again</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/components/Button/Button.css", ".surface { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button/Button.tsx", "src/components/Card/Card.tsx"],
      cssFilePaths: ["src/components/Button/Button.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-shared-without-shared-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
    assert.equal(findings[0].confidence, "medium");
    assert.equal(findings[0].subject.kind, "class-definition");
    assert.equal(findings[0].data?.className, "surface");
    assert.deepEqual(findings[0].data?.componentNames, ["Button", "Card"]);
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner consolidates repeated definitions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/surface.css";',
        'export function Button() { return <button className="surface">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import "../styles/surface.css";',
        'export function Card() { return <article className="surface">Again</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/styles/surface.css",
      [
        ".surface { display: block; }",
        "@media (min-width: 40rem) {",
        "  .surface { gap: 0.5rem; }",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/styles/surface.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-shared-without-shared-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "surface");
    assert.deepEqual(findings[0].data?.componentNames, ["Button", "Card"]);
    assert.equal(findings[0].data?.definitionCount, 2);
    assert.match(findings[0].message, /used by 2 components/);
    assert.match(findings[0].message, /defined in 2 matching selector blocks/);
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner does not report intentionally broad stylesheets", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../shared/surfaces.css";',
        'export function Button() { return <button className="surface">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import "../shared/surfaces.css";',
        'export function Card() { return <article className="surface">Again</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/shared/surfaces.css", ".surface { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Button.tsx", "src/components/Card.tsx"],
      cssFilePaths: ["src/shared/surfaces.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner treats layouts stylesheets as broad", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/layouts.css";',
        'export function Button() { return <button className="stack">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import "../styles/layouts.css";',
        'export function Card() { return <article className="stack">Again</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/layouts.css", ".stack { display: grid; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner does not report configured shared CSS globs", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharedCss: ["src/styles/**/*.css"],
      },
    })
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/surfaces.css";',
        'export function Button() { return <button className="surface">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Card.tsx",
      [
        'import "../styles/surfaces.css";',
        'export function Card() { return <article className="surface">Again</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/surfaces.css", ".surface { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner does not report when all consumers are in stylesheet directory descendants (balanced)", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharingPolicy: "balanced",
      },
    })
    .withSourceFile(
      "src/features/catalog/cards/BigCard.tsx",
      [
        'import "../Card.css";',
        'export function BigCard() { return <article className="card-surface">Big</article>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/catalog/cards/compact/SmallCard.tsx",
      [
        'import "../../Card.css";',
        'export function SmallCard() { return <article className="card-surface">Small</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/features/catalog/Card.css", ".card-surface { display: block; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner still reports when sharing crosses sibling directories (balanced)", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharingPolicy: "balanced",
      },
    })
    .withSourceFile(
      "src/features/catalog/cards/BigCard.tsx",
      [
        'import "../Card.css";',
        'export function BigCard() { return <article className="card-surface">Big</article>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/catalog/tiles/SmallTile.tsx",
      [
        'import "../cards/Card.css";',
        'export function SmallTile() { return <article className="card-surface">Small</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/features/catalog/cards/Card.css", ".card-surface { display: block; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    const findings = result.findings.filter(
      (finding) => finding.ruleId === "style-shared-without-shared-owner",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.className, "card-surface");
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner strict mode treats root index.html linked CSS as intentionally shared", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharingPolicy: "strict",
      },
    })
    .withFile(
      "index.html",
      [
        "<!doctype html>",
        "<html>",
        "<head>",
        '  <link rel="stylesheet" href="/src/styles/root-shared.css" />',
        "</head>",
        "<body></body>",
        "</html>",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/components/Button.tsx",
      'export function Button() { return <button className="root-shell">Save</button>; }\n',
    )
    .withSourceFile(
      "src/components/Card.tsx",
      'export function Card() { return <article className="root-shell">Again</article>; }\n',
    )
    .withCssFile("src/styles/root-shared.css", ".root-shell { display: block; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("single-component-style-not-colocated does not report configured shared CSS", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      ownership: {
        sharedCss: ["src/styles/**/*.css"],
      },
    })
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/layouts.css";',
        'export function Button() { return <button className="stack">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/layouts.css", ".stack { display: grid; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) => finding.ruleId === "single-component-style-not-colocated",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("single-component-style-not-colocated treats layout stylesheets as broad after colocation checks", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      [
        'import "../styles/layout.css";',
        'export function Button() { return <button className="cluster">Save</button>; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/styles/layout.css", ".cluster { display: flex; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) => finding.ruleId === "single-component-style-not-colocated",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner does not report generic family stylesheets shared by matching components", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/features/article/components/ArticleCard/ArticleCard.tsx",
      [
        'import "./Card.css";',
        'export function ArticleCard() { return <article className="card">Article</article>; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/topic/components/TopicCard/TopicCard.tsx",
      [
        'import "../../../article/components/ArticleCard/Card.css";',
        'export function TopicCard() { return <article className="card">Topic</article>; }',
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/features/article/components/ArticleCard/Card.css",
      ".card { display: block; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: [
        "src/features/article/components/ArticleCard/ArticleCard.tsx",
        "src/features/topic/components/TopicCard/TopicCard.tsx",
      ],
      cssFilePaths: ["src/features/article/components/ArticleCard/Card.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "style-shared-without-shared-owner"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("style-shared-without-shared-owner ignores intentional cross-feature family stylesheet imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/features/article/components/ArticleCard/ArticleCard.tsx",
      [
        'import "./Card.css";',
        "export function ArticleCard() {",
        '  return <article className="card card--article"><div className="card__body card__body--article" /></article>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/features/topic/components/TopicCard/TopicCard.tsx",
      [
        'import "../../../article/components/ArticleCard/Card.css";',
        "export function TopicCard() {",
        '  return <article className="card card--simple"><div className="card__body card__body--simple" /></article>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/features/article/components/ArticleCard/Card.css",
      [
        ".card { display: block; }",
        ".card--article { display: block; }",
        ".card--simple { display: block; }",
        ".card__body { padding: 1rem; }",
        ".card__body--article { min-height: 12rem; }",
        ".card__body--simple { display: flex; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "style-shared-without-shared-owner", [
      "card",
      "card--article",
      "card--simple",
      "card__body",
      "card__body--article",
      "card__body--simple",
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
