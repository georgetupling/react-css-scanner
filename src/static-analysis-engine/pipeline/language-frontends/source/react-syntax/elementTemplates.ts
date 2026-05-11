import ts from "typescript";

import { createSiteKey } from "./keys.js";
import { getJsxTagName, isIntrinsicTagName, unwrapJsxAttributeInitializer } from "./jsxUtils.js";
import type {
  ReactElementStaticAttributeFact,
  ReactElementTemplateFact,
  ReactRenderSiteFact,
} from "./types.js";

export function tryCreateElementTemplate(input: {
  node: ts.Node;
  filePath: string;
  renderSite: ReactRenderSiteFact;
}): ReactElementTemplateFact | undefined {
  if (ts.isJsxFragment(input.node)) {
    return {
      templateKey: createSiteKey("element-template", input.renderSite.location, "fragment"),
      kind: "fragment",
      filePath: input.filePath,
      location: input.renderSite.location,
      name: "fragment",
      renderSiteKey: input.renderSite.siteKey,
      ...(input.renderSite.emittingComponentKey
        ? { emittingComponentKey: input.renderSite.emittingComponentKey }
        : {}),
      ...(input.renderSite.placementComponentKey
        ? { placementComponentKey: input.renderSite.placementComponentKey }
        : {}),
    };
  }

  const tagName = getJsxTagName(input.node);
  if (!tagName) {
    return undefined;
  }
  const staticAttributes = collectStaticAttributes(input.node);

  return {
    templateKey: createSiteKey("element-template", input.renderSite.location, tagName),
    kind: isIntrinsicTagName(tagName) ? "intrinsic" : "component-candidate",
    filePath: input.filePath,
    location: input.renderSite.location,
    name: tagName,
    renderSiteKey: input.renderSite.siteKey,
    ...(staticAttributes.length > 0 ? { staticAttributes } : {}),
    ...(input.renderSite.emittingComponentKey
      ? { emittingComponentKey: input.renderSite.emittingComponentKey }
      : {}),
    ...(input.renderSite.placementComponentKey
      ? { placementComponentKey: input.renderSite.placementComponentKey }
      : {}),
  };
}

function collectStaticAttributes(node: ts.Node): ReactElementStaticAttributeFact[] {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
    return [];
  }

  const attributes = ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : node.attributes.properties;
  const result: ReactElementStaticAttributeFact[] = [];
  for (const attribute of attributes) {
    if (!ts.isJsxAttribute(attribute)) {
      continue;
    }

    const name = attribute.name.getText(node.getSourceFile());
    if (name === "className" || name === "style") {
      continue;
    }
    if (!attribute.initializer) {
      result.push({ name, value: true });
      continue;
    }

    const expression = unwrapJsxAttributeInitializer(attribute.initializer);
    if (
      expression &&
      (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ) {
      result.push({ name, value: expression.text });
    }
  }

  return result.sort((left, right) => left.name.localeCompare(right.name));
}
