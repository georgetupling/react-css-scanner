import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { createSiteKey } from "./keys.js";
import { getJsxTagName, isHelperReturnStatement, isIntrinsicTagName } from "./jsxUtils.js";
import type { ReactRenderSiteFact } from "./types.js";

export function tryCreateRenderSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  emittingComponentKey?: string;
  parentSiteKey?: string;
}): ReactRenderSiteFact | undefined {
  if (
    !ts.isJsxElement(input.node) &&
    !ts.isJsxSelfClosingElement(input.node) &&
    !ts.isJsxFragment(input.node) &&
    !ts.isConditionalExpression(input.node) &&
    !isHelperReturnStatement(input.node)
  ) {
    return undefined;
  }

  const location = toSourceAnchor(input.node, input.sourceFile, input.filePath);
  const kind = getRenderSiteKind(input.node);
  const repeatedRegion = resolveRepeatedRegionMetadata({
    node: input.node,
    sourceFile: input.sourceFile,
    filePath: input.filePath,
  });
  return {
    siteKey: createSiteKey(kind, location, input.emittingComponentKey),
    kind,
    filePath: input.filePath,
    location,
    ...(input.emittingComponentKey
      ? {
          emittingComponentKey: input.emittingComponentKey,
          placementComponentKey: input.emittingComponentKey,
        }
      : {}),
    ...(input.parentSiteKey ? { parentSiteKey: input.parentSiteKey } : {}),
    ...(repeatedRegion ? { repeatedRegion } : {}),
  };
}

function getRenderSiteKind(node: ts.Node): ReactRenderSiteFact["kind"] {
  if (ts.isJsxFragment(node)) {
    return "jsx-fragment";
  }
  if (ts.isConditionalExpression(node)) {
    return "conditional";
  }
  if (isHelperReturnStatement(node)) {
    return "helper-return";
  }
  const tagName = getJsxTagName(node);
  if (tagName && !isIntrinsicTagName(tagName)) {
    return "component-reference";
  }
  return "jsx-element";
}

function resolveRepeatedRegionMetadata(input: {
  node: ts.Node;
  sourceFile: ts.SourceFile;
  filePath: string;
}): ReactRenderSiteFact["repeatedRegion"] | undefined {
  let current: ts.Node | undefined = input.node;
  while (current) {
    if (ts.isCallExpression(current)) {
      const mapMeta = getArrayMapMetadata(current, input.sourceFile, input.filePath);
      if (mapMeta) {
        return mapMeta;
      }
      const arrayFromMeta = getArrayFromMetadata(current, input.sourceFile, input.filePath);
      if (arrayFromMeta) {
        return arrayFromMeta;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function getArrayMapMetadata(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
): ReactRenderSiteFact["repeatedRegion"] | undefined {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "map" ||
    call.arguments.length === 0
  ) {
    return undefined;
  }
  const mapper = call.arguments[0];
  if (!ts.isArrowFunction(mapper) && !ts.isFunctionExpression(mapper)) {
    return undefined;
  }
  return {
    repeatKind: "array-map",
    sourceText: call.expression.getText(sourceFile),
    sourceLocation: toSourceAnchor(call.expression, sourceFile, filePath),
    certainty: "possible",
  };
}

function getArrayFromMetadata(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
): ReactRenderSiteFact["repeatedRegion"] | undefined {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "Array" ||
    call.expression.name.text !== "from" ||
    call.arguments.length < 2
  ) {
    return undefined;
  }
  const mapper = call.arguments[1];
  if (!ts.isArrowFunction(mapper) && !ts.isFunctionExpression(mapper)) {
    return undefined;
  }
  return {
    repeatKind: "array-from",
    sourceText: call.expression.getText(sourceFile),
    sourceLocation: toSourceAnchor(call.expression, sourceFile, filePath),
    certainty: "possible",
  };
}
