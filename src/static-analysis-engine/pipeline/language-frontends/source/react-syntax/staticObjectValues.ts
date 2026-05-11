import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import type { SourceAnchor } from "../../../../types/core.js";

export type StaticObjectValueConfidence = "exact" | "partial" | "unknown";

export type StaticObjectPropertyEntry = {
  kind: "property";
  key: string;
  keyConfidence: "static" | "computed-static";
  valueExpression: ts.Expression;
  location: SourceAnchor;
  source: "property" | "shorthand" | "spread";
};

export type StaticObjectUnknownEntry = {
  kind: "unknown";
  location: SourceAnchor;
  reason: string;
};

export type StaticObjectEntry = StaticObjectPropertyEntry | StaticObjectUnknownEntry;

export type StaticObjectValueBranch = {
  entries: StaticObjectEntry[];
  confidence: Exclude<StaticObjectValueConfidence, "unknown">;
  reasons: string[];
};

export type StaticObjectValueEvaluation = {
  branches: StaticObjectValueBranch[];
  confidence: StaticObjectValueConfidence;
  reasons: string[];
};

const MAX_STATIC_OBJECT_DEPTH = 8;
const MAX_STATIC_OBJECT_BRANCHES = 16;

export function evaluateStaticObjectExpression(input: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
  filePath: string;
}): StaticObjectValueEvaluation {
  return evaluateExpression({
    expression: input.expression,
    sourceFile: input.sourceFile,
    filePath: input.filePath,
    seen: new Set(),
    depth: 0,
  });
}

export function findLastKnownPropertyAfterUnknown(
  branch: StaticObjectValueBranch,
  predicate: (entry: StaticObjectPropertyEntry) => boolean,
): StaticObjectPropertyEntry | undefined {
  const lastUnknownIndex = branch.entries.reduce(
    (lastIndex, entry, index) => (entry.kind === "unknown" ? index : lastIndex),
    -1,
  );
  for (let index = branch.entries.length - 1; index > lastUnknownIndex; index -= 1) {
    const entry = branch.entries[index];
    if (entry.kind === "property" && predicate(entry)) {
      return entry;
    }
  }
  return undefined;
}

export function getStaticPropertyName(
  name: ts.PropertyName,
  sourceFile: ts.SourceFile,
): { key: string; keyConfidence: "static" | "computed-static" } | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return { key: name.text, keyConfidence: "static" };
  }

  if (!ts.isComputedPropertyName(name)) {
    return undefined;
  }

  const value = getStaticExpressionPropertyKey(name.expression, sourceFile);
  return value ? { key: value, keyConfidence: "computed-static" } : undefined;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function evaluateExpression(input: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
  filePath: string;
  seen: Set<ts.Node>;
  depth: number;
}): StaticObjectValueEvaluation {
  if (input.depth > MAX_STATIC_OBJECT_DEPTH) {
    return unknownEvaluation("static object evaluation exceeded depth limit");
  }

  const expression = unwrapExpression(input.expression);
  if (input.seen.has(expression)) {
    return unknownEvaluation("static object evaluation encountered a cycle");
  }
  const seen = new Set(input.seen);
  seen.add(expression);

  if (ts.isObjectLiteralExpression(expression)) {
    return evaluateObjectLiteral({
      objectLiteral: expression,
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      seen,
      depth: input.depth + 1,
    });
  }

  if (ts.isConditionalExpression(expression)) {
    const whenTrue = evaluateExpression({
      ...input,
      expression: expression.whenTrue,
      seen,
      depth: input.depth + 1,
    });
    const whenFalse = evaluateExpression({
      ...input,
      expression: expression.whenFalse,
      seen,
      depth: input.depth + 1,
    });
    if (whenTrue.confidence === "unknown" || whenFalse.confidence === "unknown") {
      return unknownEvaluation("conditional object branch could not be statically evaluated", [
        ...whenTrue.reasons,
        ...whenFalse.reasons,
      ]);
    }
    return normalizeEvaluation({
      branches: [
        ...whenTrue.branches.map(markBranchPartial("conditional object branch")),
        ...whenFalse.branches.map(markBranchPartial("conditional object branch")),
      ],
      reasons: [...whenTrue.reasons, ...whenFalse.reasons, "conditional object branch"],
    });
  }

  if (ts.isIdentifier(expression)) {
    const declaration = findVisibleConstDeclaration({
      sourceFile: input.sourceFile,
      localName: expression.text,
      usage: expression,
    });
    return declaration?.initializer
      ? evaluateExpression({
          ...input,
          expression: declaration.initializer,
          seen,
          depth: input.depth + 1,
        })
      : unknownEvaluation(`identifier "${expression.text}" is not a visible const object value`);
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return evaluateMemberExpression({
      expression,
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      seen,
      depth: input.depth + 1,
    });
  }

  if (ts.isCallExpression(expression)) {
    return evaluateNoArgumentHelperCall({
      expression,
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      seen,
      depth: input.depth + 1,
    });
  }

  return unknownEvaluation("expression is not a statically analyzable object value");
}

function evaluateObjectLiteral(input: {
  objectLiteral: ts.ObjectLiteralExpression;
  sourceFile: ts.SourceFile;
  filePath: string;
  seen: Set<ts.Node>;
  depth: number;
}): StaticObjectValueEvaluation {
  let branches: StaticObjectValueBranch[] = [
    {
      entries: [],
      confidence: "exact",
      reasons: [],
    },
  ];

  for (const property of input.objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = evaluateExpression({
        expression: property.expression,
        sourceFile: input.sourceFile,
        filePath: input.filePath,
        seen: input.seen,
        depth: input.depth + 1,
      });
      branches = combineSpreadBranches({
        branches,
        spread,
        spreadLocation: toSourceAnchor(property, input.sourceFile, input.filePath),
      });
      continue;
    }

    if (ts.isPropertyAssignment(property)) {
      const key = getStaticPropertyName(property.name, input.sourceFile);
      const location = toSourceAnchor(property.name, input.sourceFile, input.filePath);
      branches = branches.map((branch) =>
        key
          ? appendEntry(branch, {
              kind: "property",
              key: key.key,
              keyConfidence: key.keyConfidence,
              valueExpression: property.initializer,
              location,
              source: "property",
            })
          : appendUnknown(branch, {
              location,
              reason: "computed object property name is not statically known",
            }),
      );
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const location = toSourceAnchor(property.name, input.sourceFile, input.filePath);
      branches = branches.map((branch) =>
        appendEntry(branch, {
          kind: "property",
          key: property.name.text,
          keyConfidence: "static",
          valueExpression: property.name,
          location,
          source: "shorthand",
        }),
      );
      continue;
    }

    branches = branches.map((branch) =>
      appendUnknown(branch, {
        location: toSourceAnchor(property, input.sourceFile, input.filePath),
        reason: "object property kind is not supported by static object evaluation",
      }),
    );
  }

  return normalizeEvaluation({ branches, reasons: [] });
}

function combineSpreadBranches(input: {
  branches: StaticObjectValueBranch[];
  spread: StaticObjectValueEvaluation;
  spreadLocation: SourceAnchor;
}): StaticObjectValueBranch[] {
  if (input.spread.confidence === "unknown") {
    return input.branches.map((branch) =>
      appendUnknown(branch, {
        location: input.spreadLocation,
        reason: input.spread.reasons[0] ?? "object spread could not be statically evaluated",
      }),
    );
  }

  const combined: StaticObjectValueBranch[] = [];
  for (const branch of input.branches) {
    for (const spreadBranch of input.spread.branches) {
      combined.push({
        entries: [
          ...branch.entries,
          ...spreadBranch.entries.map(
            (entry): StaticObjectEntry =>
              entry.kind === "property" ? { ...entry, source: "spread" } : entry,
          ),
        ],
        confidence:
          branch.confidence === "partial" || spreadBranch.confidence === "partial"
            ? "partial"
            : "exact",
        reasons: [...branch.reasons, ...spreadBranch.reasons],
      });
    }
  }

  if (combined.length > MAX_STATIC_OBJECT_BRANCHES) {
    return input.branches.map((branch) =>
      appendUnknown(branch, {
        location: input.spreadLocation,
        reason: "object spread branch count exceeded static evaluation limit",
      }),
    );
  }

  return combined;
}

function evaluateMemberExpression(input: {
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  sourceFile: ts.SourceFile;
  filePath: string;
  seen: Set<ts.Node>;
  depth: number;
}): StaticObjectValueEvaluation {
  const receiver = input.expression.expression;
  const key = ts.isPropertyAccessExpression(input.expression)
    ? input.expression.name.text
    : getStaticExpressionPropertyKey(input.expression.argumentExpression, input.sourceFile);
  if (!key) {
    return unknownEvaluation("member expression property key is not statically known");
  }

  const receiverValue = evaluateExpression({
    expression: receiver,
    sourceFile: input.sourceFile,
    filePath: input.filePath,
    seen: input.seen,
    depth: input.depth + 1,
  });
  if (receiverValue.confidence === "unknown") {
    return receiverValue;
  }

  const alternatives: StaticObjectValueBranch[] = [];
  const reasons = [...receiverValue.reasons];
  for (const branch of receiverValue.branches) {
    const property = findLastKnownPropertyAfterUnknown(branch, (entry) => entry.key === key);
    if (!property) {
      reasons.push(`member property "${key}" is not statically known after unknown object entries`);
      continue;
    }

    const value = evaluateExpression({
      expression: property.valueExpression,
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      seen: input.seen,
      depth: input.depth + 1,
    });
    if (value.confidence !== "unknown") {
      alternatives.push(...value.branches);
      reasons.push(...value.reasons);
    }
  }

  return alternatives.length > 0
    ? normalizeEvaluation({ branches: alternatives, reasons })
    : unknownEvaluation(
        `member property "${key}" could not be resolved as an object value`,
        reasons,
      );
}

function evaluateNoArgumentHelperCall(input: {
  expression: ts.CallExpression;
  sourceFile: ts.SourceFile;
  filePath: string;
  seen: Set<ts.Node>;
  depth: number;
}): StaticObjectValueEvaluation {
  if (input.expression.arguments.length > 0 || !ts.isIdentifier(input.expression.expression)) {
    return unknownEvaluation("call expression is not a supported no-argument local helper");
  }

  const helper = findVisibleNoArgumentHelper({
    sourceFile: input.sourceFile,
    localName: input.expression.expression.text,
    usage: input.expression.expression,
  });
  if (!helper) {
    return unknownEvaluation(
      `helper "${input.expression.expression.text}" is not a visible no-argument local helper`,
    );
  }

  const returnExpressions = getHelperReturnExpressions(helper);
  if (returnExpressions.length === 0) {
    return unknownEvaluation(
      `helper "${input.expression.expression.text}" has no statically analyzable return value`,
    );
  }

  const branches = returnExpressions.flatMap((expression) => {
    const evaluated = evaluateExpression({
      expression,
      sourceFile: input.sourceFile,
      filePath: input.filePath,
      seen: input.seen,
      depth: input.depth + 1,
    });
    return evaluated.confidence === "unknown" ? [] : evaluated.branches;
  });

  return branches.length > 0
    ? normalizeEvaluation({
        branches: branches.map(
          returnExpressions.length > 1
            ? markBranchPartial("helper has multiple possible return object branches")
            : (branch) => branch,
        ),
        reasons:
          returnExpressions.length > 1
            ? ["helper has multiple possible return object branches"]
            : [],
      })
    : unknownEvaluation(
        `helper "${input.expression.expression.text}" did not return object values`,
      );
}

function getStaticExpressionPropertyKey(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!expression) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNumericLiteral(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  if (
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return unwrapped.getText(sourceFile);
  }
  if (ts.isIdentifier(unwrapped)) {
    const declaration = findVisibleConstDeclaration({
      sourceFile,
      localName: unwrapped.text,
      usage: unwrapped,
    });
    if (declaration?.initializer) {
      return getStaticExpressionPropertyKey(declaration.initializer, sourceFile);
    }
  }
  return undefined;
}

function findVisibleConstDeclaration(input: {
  sourceFile: ts.SourceFile;
  localName: string;
  usage: ts.Identifier;
}): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = input.usage;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isModuleBlock(current)) {
      const declaration = findConstDeclarationInStatements({
        statements: current.statements,
        localName: input.localName,
        usage: input.usage,
      });
      if (declaration) {
        return declaration;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function findConstDeclarationInStatements(input: {
  statements: ts.NodeArray<ts.Statement>;
  localName: string;
  usage: ts.Identifier;
}): ts.VariableDeclaration | undefined {
  for (const statement of input.statements) {
    if (statement.pos > input.usage.pos) {
      break;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
    if (!isConst) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.pos <= input.usage.pos &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === input.localName &&
        declaration.initializer
      ) {
        return declaration;
      }
    }
  }
  return undefined;
}

function findVisibleNoArgumentHelper(input: {
  sourceFile: ts.SourceFile;
  localName: string;
  usage: ts.Identifier;
}): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | undefined {
  let current: ts.Node | undefined = input.usage;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isModuleBlock(current)) {
      const helper = findNoArgumentHelperInStatements({
        statements: current.statements,
        localName: input.localName,
        usage: input.usage,
      });
      if (helper) {
        return helper;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function findNoArgumentHelperInStatements(input: {
  statements: ts.NodeArray<ts.Statement>;
  localName: string;
  usage: ts.Identifier;
}): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | undefined {
  for (const statement of input.statements) {
    if (statement.pos > input.usage.pos) {
      break;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === input.localName &&
      statement.parameters.length === 0
    ) {
      return statement;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
    if (!isConst) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.pos <= input.usage.pos &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === input.localName &&
        declaration.initializer &&
        (ts.isFunctionExpression(declaration.initializer) ||
          ts.isArrowFunction(declaration.initializer)) &&
        declaration.initializer.parameters.length === 0
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

function getHelperReturnExpressions(
  helper: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): ts.Expression[] {
  if (ts.isArrowFunction(helper) && !ts.isBlock(helper.body)) {
    return [helper.body];
  }
  if (!helper.body || !ts.isBlock(helper.body)) {
    return [];
  }

  return helper.body.statements.flatMap((statement) =>
    ts.isReturnStatement(statement) && statement.expression ? [statement.expression] : [],
  );
}

function appendEntry(
  branch: StaticObjectValueBranch,
  entry: StaticObjectPropertyEntry,
): StaticObjectValueBranch {
  return {
    ...branch,
    entries: [...branch.entries, entry],
  };
}

function appendUnknown(
  branch: StaticObjectValueBranch,
  entry: Omit<StaticObjectUnknownEntry, "kind">,
): StaticObjectValueBranch {
  return {
    entries: [...branch.entries, { kind: "unknown", ...entry }],
    confidence: "partial",
    reasons: [...branch.reasons, entry.reason],
  };
}

function markBranchPartial(
  reason: string,
): (branch: StaticObjectValueBranch) => StaticObjectValueBranch {
  return (branch) => ({
    ...branch,
    confidence: "partial",
    reasons: [...branch.reasons, reason],
  });
}

function normalizeEvaluation(input: {
  branches: StaticObjectValueBranch[];
  reasons: string[];
}): StaticObjectValueEvaluation {
  const reasons = uniqueSorted([
    ...input.reasons,
    ...input.branches.flatMap((branch) => branch.reasons),
  ]);
  return {
    branches: input.branches,
    confidence: input.branches.some((branch) => branch.confidence === "partial")
      ? "partial"
      : "exact",
    reasons,
  };
}

function unknownEvaluation(
  reason: string,
  additionalReasons: string[] = [],
): StaticObjectValueEvaluation {
  return {
    branches: [],
    confidence: "unknown",
    reasons: uniqueSorted([reason, ...additionalReasons]),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
