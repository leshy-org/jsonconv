export interface FieldMapping {
  leftField: string;
  rightField: string;
  leftTransform?: TransformConfig;
  rightTransform?: TransformConfig;
}

export interface TransformConfig {
  type: 'prefix' | 'suffix' | 'replace' | 'regex' | 'trim' | 'lowercase' | 'uppercase' | 'substring' | 'padStart' | 'padEnd' | 'extract' | 'split' | 'parseTlv' | 'toInt' | 'chain' | 'custom';
  args?: Record<string, string | number>;
  steps?: TransformConfig[];
}

export interface NestedMatchConfig {
  enabled: boolean;
  mode: 'parent-child' | 'independent';
  leftArrayPath: string;
  rightArrayPath: string;
  fieldMappings: FieldMapping[];
  outputMode: 'nested' | 'flat';
  outputArrayName?: string;
}

export interface EnumOption {
  value: string;
  display: string;
}

export interface FloatFieldConfig {
  defaultValue: string;
  operator1: string;
  operator2: string;
  format: string;
}

export interface EnumFieldConfig {
  defaultValue: string;
  matchDisplay: string;
  noMatchDisplay: string;
  options: EnumOption[];
}

export interface CharFieldConfig {
  defaultValue: string;
}

export interface IntFieldConfig {
  defaultValue: string;
  radix: number;
}

export interface ParsedFieldDef {
  name: string;
  typeMarker: string;
  type: 'float' | 'enum' | 'char' | 'int' | 'raw';
  config?: FloatFieldConfig | EnumFieldConfig | CharFieldConfig | IntFieldConfig;
}

export interface PreprocessRule {
  field: string;
  enabled: boolean;
  pairSeparator: string;
  kvSeparator: string;
  fields: ParsedFieldDef[];
}

export interface PreprocessConfig {
  enabled: boolean;
  rules: PreprocessRule[];
}

export interface MergeConfig {
  leftFile: string;
  rightFile: string;
  outputFile: string;
  fieldMappings: FieldMapping[];
  mergeMode: 'left' | 'right' | 'inner' | 'full';
  leftAlias?: string;
  rightAlias?: string;
  selectFields?: {
    left?: string[];
    right?: string[];
  };
  conflictStrategy?: 'overwrite' | 'skip' | 'prefix' | 'rename';
  unmatchedLeft?: 'include' | 'exclude';
  unmatchedRight?: 'include' | 'exclude';
  nestedMatch?: NestedMatchConfig;
  leftPreprocess?: PreprocessConfig;
  rightPreprocess?: PreprocessConfig;
}

export interface MergeResult {
  data: Record<string, unknown>[];
  stats: {
    leftTotal: number;
    rightTotal: number;
    matched: number;
    unmatchedLeft: number;
    unmatchedRight: number;
    outputTotal: number;
    nestedMatched?: number;
  };
}

export interface FieldInfo {
  name: string;
  type: string;
  sample: unknown;
  isArray?: boolean;
  children?: FieldInfo[];
}

export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
}

export interface TemplateField {
  path: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: unknown;
  sampleValue?: unknown;
  constraints?: FieldConstraints;
}

export interface JsonTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDiff {
  path: string;
  status: 'match' | 'missing' | 'extra' | 'type_mismatch' | 'constraint_violation';
  expected?: string;
  actual?: string;
  message: string;
}

export interface TemplateValidationResult {
  isValid: boolean;
  matchCount: number;
  missingCount: number;
  extraCount: number;
  violationCount: number;
  diffs: TemplateDiff[];
}
