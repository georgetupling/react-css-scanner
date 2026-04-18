import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

import { evaluateClassExpression } from "../../dist/class-expression-evaluator/index.js";

function evaluateFromSource(source, options = {}) {
  const parsed = ts.createSourceFile(
    "Fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const localBindings = new Map();
  const localFunctions = new Map();
  let targetExpression;

  walk(parsed, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstBinding(node)
    ) {
      localBindings.set(node.name.text, node.initializer);
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const bodyExpression = getFunctionBodyExpression(node);
      if (bodyExpression) {
        localFunctions.set(node.name.text, {
          bodyExpression,
          parameters: node.parameters,
        });
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstBinding(node) &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const bodyExpression = getFunctionBodyExpression(node.initializer);
      if (bodyExpression) {
        localFunctions.set(node.name.text, {
          bodyExpression,
          parameters: node.initializer.parameters,
        });
      }
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "className" &&
      (ts.isJsxExpression(node.initializer) ||
        ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      targetExpression = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
    }
  });

  assert.ok(targetExpression);

  return evaluateClassExpression(targetExpression, {
    helperImports: new Set(options.helperImports ?? ["clsx"]),
    localBindings,
    localFunctions,
    parsedSourceFile: parsed,
  });
}

test("template expressions downgrade interpolated tokens to possible when not fully static", () => {
  const result = evaluateFromSource(
    "export function App() { return <div className={`panel ${getStateClass()}`} />; }",
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [["panel", "definite"]],
  );
  assert.ok(result.dynamics.some((entry) => entry.source === "getStateClass()"));
});

test("direct string literals split into definite class tokens", () => {
  const result = evaluateFromSource(
    'export function App() { return <div className="button button--sm" />; }',
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["button", "definite"],
      ["button--sm", "definite"],
    ],
  );
  assert.equal(result.dynamics.length, 0);
});

test("simple fully static template literals are recovered as definite tokens", () => {
  const result = evaluateFromSource(
    "export function App() { return <div className={`button button--sm`} />; }",
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["button", "definite"],
      ["button--sm", "definite"],
    ],
  );
  assert.equal(result.dynamics.length, 0);
});

test("finite ternary conditionals mark shared tokens definite and branch tokens possible", () => {
  const result = evaluateFromSource(
    [
      "const isOpen = getOpenState();",
      'export function App() { return <div className={isOpen ? "panel is-open" : "panel"} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens
      .map((token) => [token.token, token.certainty])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ["is-open", "possible"],
      ["panel", "definite"],
    ],
  );
});

test("boolean-gated expressions become definite when the gate resolves statically", () => {
  const result = evaluateFromSource(
    [
      "const isOpen = true;",
      'export function App() { return <div className={isOpen && "panel--open"} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [["panel--open", "definite"]],
  );
  assert.equal(result.dynamics.length, 0);
});

test("logical or falls back to the right side when the left side is statically falsy", () => {
  const result = evaluateFromSource(
    [
      'const maybeClass = "";',
      'export function App() { return <div className={maybeClass || "fallback"} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [["fallback", "definite"]],
  );
});

test("nullish coalescing falls back to the right side when the left side is statically null", () => {
  const result = evaluateFromSource(
    [
      "const maybeClass = null;",
      'export function App() { return <div className={maybeClass ?? "fallback"} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [["fallback", "definite"]],
  );
});

test("binary string concatenation is recovered when it is fully static", () => {
  const result = evaluateFromSource(
    [
      'const variant = "primary";',
      'export function App() { return <div className={"button" + " " + ("button--" + variant)} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["button", "definite"],
      ["button--primary", "definite"],
    ],
  );
  assert.equal(result.dynamics.length, 0);
});

test("parenthesized expressions are unwrapped before evaluation", () => {
  const result = evaluateFromSource(
    'export function App() { return <div className={("panel panel--open")} />; }',
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["panel", "definite"],
      ["panel--open", "definite"],
    ],
  );
});

test("finite variant template literals resolved through const indirection stay definite", () => {
  const result = evaluateFromSource(
    [
      'const variant = "ghost";',
      "const classes = `button button--${variant}`;",
      "export function App() { return <button className={classes} />; }",
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["button", "definite"],
      ["button--ghost", "definite"],
    ],
  );
  assert.equal(result.dynamics.length, 0);
});

test('array filter(Boolean).join(" ") expressions are evaluated directly', () => {
  const result = evaluateFromSource(
    [
      "const isSmall = true;",
      'export function App() { return <button className={["button", isSmall && "button--sm"].filter(Boolean).join(" ")} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.certainty]),
    [
      ["button", "definite"],
      ["button--sm", "definite"],
    ],
  );
});

test("transparent same-file join helpers are evaluated without helper-name guessing", () => {
  const result = evaluateFromSource(
    [
      "function joinClasses(...classes) {",
      '  return classes.filter(Boolean).join(" ");',
      "}",
      "const isSmall = true;",
      'export function App() { return <button className={joinClasses("button", isSmall && "button--sm")} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => [token.token, token.kind, token.certainty]),
    [
      ["button", "expression-evaluated", "definite"],
      ["button--sm", "expression-evaluated", "definite"],
    ],
  );
  assert.equal(result.dynamics.length, 0);
});

test("unsupported helper calls stay dynamic instead of inventing tokens", () => {
  const result = evaluateFromSource(
    'export function App() { return <div className={unknownJoin("panel", maybeClass)} />; }',
  );

  assert.deepEqual(result.tokens, []);
  assert.ok(result.dynamics.some((entry) => entry.kind === "helper-call"));
});

test("imported helper object syntax produces possible tokens for conditional keys", () => {
  const result = evaluateFromSource(
    [
      "const enabled = false;",
      "export function App() { return <div className={clsx({ panel: true, open: enabled })} />; }",
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens
      .map((token) => [token.token, token.certainty])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ["open", "possible"],
      ["panel", "definite"],
    ],
  );
});

test("checkbox-style local helper composition keeps base and conditional modifier classes", () => {
  const result = evaluateFromSource(
    [
      "function joinClasses(...classes) {",
      '  return classes.filter(Boolean).join(" ");',
      "}",
      "const disabled = true;",
      'export function Checkbox() { return <label className={joinClasses("checkbox", disabled && "checkbox--disabled")} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => token.token),
    ["checkbox", "checkbox--disabled"],
  );
});

test("toast-style helper composition recovers base and variant classes", () => {
  const result = evaluateFromSource(
    [
      "function joinClasses(...classes) {",
      '  return classes.filter(Boolean).join(" ");',
      "}",
      'const variant = "error";',
      'export function Toast() { return <section className={joinClasses("toast", `toast--${variant}`)} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => token.token),
    ["toast", "toast--error"],
  );
});

test("tag-builder style mixed local and utility classes are both recovered", () => {
  const result = evaluateFromSource(
    [
      "function joinClasses(...classes) {",
      '  return classes.filter(Boolean).join(" ");',
      "}",
      'export function TagBuilder() { return <div className={joinClasses("tag-builder__list cluster")} />; }',
    ].join("\n"),
  );

  assert.deepEqual(
    result.tokens.map((token) => token.token).sort((left, right) => left.localeCompare(right)),
    ["cluster", "tag-builder__list"],
  );
});

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function isConstBinding(node) {
  const list = node.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function getFunctionBodyExpression(node) {
  if (ts.isArrowFunction(node) && ts.isExpression(node.body)) {
    return node.body;
  }

  if (!node.body || !ts.isBlock(node.body) || node.body.statements.length !== 1) {
    return undefined;
  }

  const [statement] = node.body.statements;
  if (!ts.isReturnStatement(statement) || !statement.expression) {
    return undefined;
  }

  return statement.expression;
}
