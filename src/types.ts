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
  };
}
