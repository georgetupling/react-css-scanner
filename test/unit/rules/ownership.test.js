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

test("style-used-outside-owner reports classes consumed outside a single importing component owner", async () => {
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
