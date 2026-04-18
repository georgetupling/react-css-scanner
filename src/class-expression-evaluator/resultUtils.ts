import type { ConfidenceLevel } from "../config/types.js";
import type { ClassReferenceFact } from "../facts/types.js";
import type { ClassExpressionEvaluation, TokenCertainty, TokenEvaluation } from "./types.js";

export function emptyEvaluation(): ClassExpressionEvaluation {
  return {
    tokens: [],
    dynamics: [],
  };
}

export function dynamicOnly(
  anchorNode: TokenEvaluation["anchorNode"],
  kind: ClassReferenceFact["kind"],
  confidence: ClassReferenceFact["confidence"],
): ClassExpressionEvaluation {
  return {
    tokens: [],
    dynamics: [
      {
        anchorNode,
        kind,
        confidence,
        source: anchorNode.getText(),
      },
    ],
  };
}

export function tokensFromString(
  value: string,
  anchorNode: TokenEvaluation["anchorNode"],
  kind: ClassReferenceFact["kind"],
  confidence: ClassReferenceFact["confidence"],
): ClassExpressionEvaluation {
  const result = emptyEvaluation();

  for (const token of tokenizeClassNames(value)) {
    result.tokens.push({
      token,
      certainty: "definite",
      kind,
      confidence,
      source: value,
      anchorNode,
    });
  }

  return result;
}

export function tokenResult(
  tokenValue: string,
  certainty: TokenCertainty,
  anchorNode: TokenEvaluation["anchorNode"],
  kind: ClassReferenceFact["kind"],
  confidence: ClassReferenceFact["confidence"],
  source: string,
): ClassExpressionEvaluation {
  const result = emptyEvaluation();

  for (const token of tokenizeClassNames(tokenValue)) {
    result.tokens.push({
      token,
      certainty,
      kind,
      confidence,
      source,
      anchorNode,
    });
  }

  return result;
}

export function mergeInto(
  target: ClassExpressionEvaluation,
  input: ClassExpressionEvaluation,
): void {
  target.tokens.push(...input.tokens);
  target.dynamics.push(...input.dynamics);
}

export function normalizeEvaluation(input: ClassExpressionEvaluation): ClassExpressionEvaluation {
  const tokensByName = new Map<string, TokenEvaluation>();

  for (const token of input.tokens) {
    const existing = tokensByName.get(token.token);
    if (!existing) {
      tokensByName.set(token.token, token);
      continue;
    }

    tokensByName.set(token.token, choosePreferredToken(existing, token) ?? token);
  }

  const dynamicKeys = new Set<string>();
  const dynamics = input.dynamics.filter((entry) => {
    const key = `${entry.kind}:${entry.confidence}:${entry.source}:${entry.anchorNode.pos}`;
    if (dynamicKeys.has(key)) {
      return false;
    }

    dynamicKeys.add(key);
    return true;
  });

  return {
    tokens: [...tokensByName.values()],
    dynamics,
  };
}

export function mergeBranchResults(
  left: ClassExpressionEvaluation,
  right: ClassExpressionEvaluation,
): ClassExpressionEvaluation {
  const result = emptyEvaluation();
  const leftTokens = indexTokens(left.tokens);
  const rightTokens = indexTokens(right.tokens);
  const allTokenNames = new Set([...leftTokens.keys(), ...rightTokens.keys()]);

  for (const tokenName of allTokenNames) {
    const leftToken = leftTokens.get(tokenName);
    const rightToken = rightTokens.get(tokenName);
    const certainty: TokenCertainty =
      leftToken?.certainty === "definite" && rightToken?.certainty === "definite"
        ? "definite"
        : "possible";
    const sourceToken = choosePreferredToken(leftToken, rightToken);
    if (!sourceToken) {
      continue;
    }

    result.tokens.push({
      ...sourceToken,
      certainty,
      kind: "expression-evaluated",
      confidence: certainty === "definite" ? sourceToken.confidence : "medium",
    });
  }

  result.dynamics.push(...left.dynamics, ...right.dynamics);
  return result;
}

export function markAllTokensAsExpressionEvaluated(
  result: ClassExpressionEvaluation,
): ClassExpressionEvaluation {
  return {
    tokens: result.tokens.map((token) => ({
      ...token,
      kind: "expression-evaluated",
      confidence: token.certainty === "definite" ? token.confidence : "medium",
    })),
    dynamics: result.dynamics,
  };
}

export function downgradeTokensToPossible(
  result: ClassExpressionEvaluation,
): ClassExpressionEvaluation {
  return {
    tokens: result.tokens.map((token) => ({
      ...token,
      certainty: "possible",
      kind: "expression-evaluated",
      confidence: downgradeConfidence(token.confidence),
    })),
    dynamics: result.dynamics,
  };
}

function indexTokens(tokens: TokenEvaluation[]): Map<string, TokenEvaluation> {
  const result = new Map<string, TokenEvaluation>();

  for (const token of tokens) {
    result.set(token.token, choosePreferredToken(result.get(token.token), token) ?? token);
  }

  return result;
}

function choosePreferredToken(
  left: TokenEvaluation | undefined,
  right: TokenEvaluation | undefined,
): TokenEvaluation | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left.certainty !== right.certainty) {
    return left.certainty === "definite" ? left : right;
  }

  if (compareConfidence(left.confidence, right.confidence) !== 0) {
    return compareConfidence(left.confidence, right.confidence) > 0 ? left : right;
  }

  return left;
}

function compareConfidence(left: ConfidenceLevel, right: ConfidenceLevel): number {
  return confidenceRank(left) - confidenceRank(right);
}

function confidenceRank(value: ConfidenceLevel): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function downgradeConfidence(value: ConfidenceLevel): ConfidenceLevel {
  if (value === "high") {
    return "medium";
  }

  return value;
}

function tokenizeClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}
