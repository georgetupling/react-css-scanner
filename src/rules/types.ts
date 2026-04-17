import type { ProjectModel } from "../model/types.js";
import type {
  Finding,
  FindingConfidence,
  FindingLocation,
  FindingSeverity,
  FindingSubject,
} from "../runtime/types.js";
import type { RuleSeverity } from "../config/types.js";

export type RuleFamily =
  | "definition-and-usage-integrity"
  | "ownership-and-organization"
  | "dynamic-analysis"
  | "css-modules"
  | "external-css"
  | "optimization-and-migration";

export type RuleDefinition = {
  ruleId: string;
  family: RuleFamily;
  defaultSeverity: FindingSeverity;
  run(context: RuleContext): Finding[];
};

export type RuleContext = {
  model: ProjectModel;
  createFinding(input: CreateFindingInput): Finding;
  getRuleSeverity(ruleId: string, defaultSeverity: FindingSeverity): RuleSeverity;
};

export type CreateFindingInput = {
  ruleId: string;
  family: RuleFamily;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  message: string;
  primaryLocation?: FindingLocation;
  relatedLocations?: FindingLocation[];
  subject?: FindingSubject;
  metadata?: Record<string, unknown>;
};

export type RuleEngineResult = {
  findings: Finding[];
};
