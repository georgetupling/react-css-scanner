import type { ClassExpressionSummary } from "../render-model/abstract-values/types.js";

export type PresenceEvaluation = "definite" | "possible" | "unsupported" | "no-match";

export function evaluateClassRequirement(
  className: ClassExpressionSummary | undefined,
  requiredClassNames: string[],
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (!className) {
    return "no-match";
  }

  let sawPossible = false;
  let sawUnsupported = false;

  for (const requiredClassName of requiredClassNames) {
    const presence = evaluateSingleClassPresence(className, requiredClassName);
    if (presence === "no-match") {
      return "no-match";
    }

    if (presence === "possible") {
      sawPossible = true;
    }

    if (presence === "unsupported") {
      sawUnsupported = true;
    }
  }

  if (sawUnsupported) {
    return "unsupported";
  }

  return sawPossible ? "possible-match" : "match";
}

export function evaluateSingleClassPresence(
  className: ClassExpressionSummary | undefined,
  requiredClassName: string,
): PresenceEvaluation {
  if (!className) {
    return "no-match";
  }

  if (className.classes.definite.includes(requiredClassName)) {
    return "definite";
  }

  if (className.classes.possible.includes(requiredClassName)) {
    return "possible";
  }

  if (className.classes.unknownDynamic) {
    return "unsupported";
  }

  return "no-match";
}

export function combinePresence(
  ancestorPresence: Exclude<PresenceEvaluation, "no-match">,
  subjectPresence: PresenceEvaluation,
): "match" | "possible-match" | "unsupported" | "no-match" {
  if (subjectPresence === "no-match") {
    return "no-match";
  }

  if (ancestorPresence === "unsupported" || subjectPresence === "unsupported") {
    return "unsupported";
  }

  if (ancestorPresence === "definite" && subjectPresence === "definite") {
    return "match";
  }

  return "possible-match";
}
