import type { SourceAnchor } from "../../../../types/core.js";
import type { SourceExpressionSyntaxFact } from "../expression-syntax/index.js";

export type SourceReactSyntaxFacts = {
  components: ReactComponentDeclarationFact[];
  renderSites: ReactRenderSiteFact[];
  elementTemplates: ReactElementTemplateFact[];
  classExpressionSites: ReactClassExpressionSiteFact[];
  componentPropBindings: ReactComponentPropBindingFact[];
  localValueBindings: ReactLocalValueBindingFact[];
  helperDefinitions: ReactHelperDefinitionFact[];
  expressionSyntax: SourceExpressionSyntaxFact[];
};

export type ReactComponentDeclarationFact = {
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  declarationKind: "function" | "variable" | "class";
  evidence: string;
  location: SourceAnchor;
};

export type ReactRenderSiteFact = {
  siteKey: string;
  kind:
    | "component-root"
    | "jsx-element"
    | "component-reference"
    | "jsx-fragment"
    | "conditional"
    | "helper-return";
  filePath: string;
  location: SourceAnchor;
  emittingComponentKey?: string;
  placementComponentKey?: string;
  parentSiteKey?: string;
  elementTemplateKey?: string;
};

export type ReactElementTemplateFact = {
  templateKey: string;
  kind: "intrinsic" | "component-candidate" | "fragment";
  filePath: string;
  location: SourceAnchor;
  name: string;
  renderSiteKey: string;
  emittingComponentKey?: string;
  placementComponentKey?: string;
};

export type ReactClassExpressionSiteFact = {
  siteKey: string;
  kind: "jsx-class" | "component-prop-class" | "css-module-member" | "runtime-dom-class";
  filePath: string;
  location: SourceAnchor;
  expressionId: string;
  rawExpressionText: string;
  emittingComponentKey?: string;
  placementComponentKey?: string;
  renderSiteKey?: string;
  elementTemplateKey?: string;
};

export type ReactComponentPropBindingFact = {
  bindingKey: string;
  componentKey: string;
  filePath: string;
  location: SourceAnchor;
  bindingKind: "none" | "props-identifier" | "destructured-props" | "unsupported";
  identifierName?: string;
  properties: ReactDestructuredBindingPropertyFact[];
  unsupportedReason?: ReactUnsupportedBindingReason;
};

export type ReactDestructuredBindingPropertyFact = {
  propertyName: string;
  localName: string;
  location: SourceAnchor;
  initializerExpressionId?: string;
};

export type ReactLocalValueBindingFact = {
  bindingKey: string;
  ownerKind: "component" | "helper";
  ownerKey: string;
  filePath: string;
  localName: string;
  location: SourceAnchor;
  bindingKind: "const-identifier" | "destructured-property";
  expressionId?: string;
  objectExpressionId?: string;
  propertyName?: string;
  initializerExpressionId?: string;
};

export type ReactHelperDefinitionFact = {
  helperKey: string;
  helperName: string;
  filePath: string;
  location: SourceAnchor;
  ownerKind: "source-file" | "component" | "helper";
  ownerKey: string;
  definitionKind: "function-declaration" | "function-expression" | "arrow-function";
  parameters: ReactHelperParameterBindingFact[];
  restParameterName?: string;
  returnExpressionId?: string;
  unsupportedReason?: ReactUnsupportedBindingReason;
};

export type ReactHelperParameterBindingFact =
  | {
      parameterKind: "identifier";
      localName: string;
      location: SourceAnchor;
    }
  | {
      parameterKind: "destructured-object";
      location: SourceAnchor;
      properties: ReactDestructuredBindingPropertyFact[];
    }
  | {
      parameterKind: "rest";
      localName: string;
      location: SourceAnchor;
    }
  | {
      parameterKind: "unsupported";
      location: SourceAnchor;
      unsupportedReason: ReactUnsupportedBindingReason;
    };

export type ReactUnsupportedBindingReason =
  | "multiple-parameters"
  | "unsupported-parameter-pattern"
  | "unsupported-destructured-props"
  | "unsupported-destructured-binding"
  | "unsupported-helper-return";
