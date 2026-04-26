import {
  PreprocessConfig,
  PreprocessRule,
  ParsedFieldDef,
  FloatFieldConfig,
  EnumFieldConfig,
  CharFieldConfig,
  IntFieldConfig,
} from './types';

export function applyPreprocess(
  data: Record<string, unknown>[],
  config: PreprocessConfig
): Record<string, unknown>[] {
  if (!config.enabled || !config.rules || config.rules.length === 0) {
    return data;
  }

  return data.map(item => applyPreprocessToItem(item, config.rules));
}

function applyPreprocessToItem(
  item: Record<string, unknown>,
  rules: PreprocessRule[]
): Record<string, unknown> {
  const result = { ...item };

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const rawValue = result[rule.field];
    if (typeof rawValue !== 'string') continue;

    const parsed = parseFieldString(rawValue, rule);
    delete result[rule.field];

    for (const [key, value] of Object.entries(parsed)) {
      result[key] = value;
    }
  }

  return result;
}

function parseFieldString(
  rawValue: string,
  rule: PreprocessRule
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pairs = rawValue.split(rule.pairSeparator);

  for (let i = 0; i < pairs.length && i < rule.fields.length; i++) {
    const pair = pairs[i].trim();
    const fieldDef = rule.fields[i];

    if (!fieldDef) continue;

    const parts = pair.split(rule.kvSeparator);
    const parsedValue = parseFieldValue(parts, fieldDef);
    result[fieldDef.name] = parsedValue;
  }

  return result;
}

function parseFieldValue(
  parts: string[],
  fieldDef: ParsedFieldDef
): { value: unknown; display: string; raw: string } {
  const raw = parts[0] ?? '';

  switch (fieldDef.type) {
    case 'float':
      return parseFloatField(parts, fieldDef.config as FloatFieldConfig);
    case 'enum':
      return parseEnumField(parts, fieldDef.config as EnumFieldConfig);
    case 'char':
      return parseCharField(parts, fieldDef.config as CharFieldConfig);
    case 'int':
      return parseIntField(parts, fieldDef.config as IntFieldConfig);
    case 'raw':
    default:
      return { value: raw, display: raw, raw };
  }
}

function parseFloatField(
  parts: string[],
  config: FloatFieldConfig
): { value: number | null; display: string; raw: string } {
  const raw = parts[0] ?? '';
  const defaultValue = config?.defaultValue ?? '';
  const operator1 = config?.operator1 ?? '';
  const operator2 = config?.operator2 ?? '';
  const format = config?.format ?? '{0}';

  if (!raw || raw.trim() === '') {
    return { value: null, display: defaultValue, raw };
  }

  let numValue = parseFloat(raw);
  if (isNaN(numValue)) {
    return { value: null, display: defaultValue, raw };
  }

  let result1 = numValue;
  let result2 = 0;

  if (operator1) {
    result1 = applyOperator(numValue, operator1);
  }

  if (operator2) {
    result2 = applyOperator(numValue, operator2);
  }

  const display = format
    .replace('{0}', String(result1))
    .replace('{1}', String(result2));

  return { value: result1, display, raw };
}

function applyOperator(value: number, operator: string): number {
  const match = operator.match(/^([*/%+\-])(\d+\.?\d*)$/);
  if (!match) return value;

  const op = match[1];
  const operand = parseFloat(match[2]);

  switch (op) {
    case '*':
      return value * operand;
    case '/':
      return operand !== 0 ? value / operand : value;
    case '%':
      return value % operand;
    case '+':
      return value + operand;
    case '-':
      return value - operand;
    default:
      return value;
  }
}

function parseEnumField(
  parts: string[],
  config: EnumFieldConfig
): { value: string; display: string; raw: string } {
  const raw = parts[0] ?? '';
  const defaultValue = config?.defaultValue ?? '';
  const matchDisplay = config?.matchDisplay ?? '';
  const noMatchDisplay = config?.noMatchDisplay ?? '';
  const options = config?.options ?? [];

  if (!raw || raw.trim() === '') {
    return { value: '', display: defaultValue, raw };
  }

  const option = options.find(opt => opt.value === raw);

  if (option) {
    const display = matchDisplay.replace('{value}', option.display);
    return { value: raw, display: option.display, raw };
  }

  const display = noMatchDisplay.replace('{value}', raw);
  return { value: raw, display, raw };
}

function parseCharField(
  parts: string[],
  config: CharFieldConfig
): { value: string; display: string; raw: string } {
  const raw = parts[0] ?? '';
  const defaultValue = config?.defaultValue ?? '';

  if (!raw || raw.trim() === '') {
    return { value: '', display: defaultValue, raw };
  }

  return { value: raw, display: raw, raw };
}

function parseIntField(
  parts: string[],
  config: IntFieldConfig
): { value: number | null; display: string; raw: string } {
  const raw = parts[0] ?? '';
  const defaultValue = config?.defaultValue ?? '';
  const radix = config?.radix ?? 10;

  if (!raw || raw.trim() === '') {
    return { value: null, display: defaultValue, raw };
  }

  const trimmed = raw.trim();
  let numValue: number;

  if (radix === 0 || radix === 16) {
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      numValue = parseInt(trimmed.slice(2), 16);
    } else if (radix === 0) {
      numValue = parseInt(trimmed, 10);
    } else {
      numValue = parseInt(trimmed, radix);
    }
  } else {
    numValue = parseInt(trimmed, radix);
  }

  if (isNaN(numValue)) {
    return { value: null, display: defaultValue, raw };
  }

  return { value: numValue, display: String(numValue), raw };
}

export function previewPreprocess(
  data: Record<string, unknown>[],
  config: PreprocessConfig
): { original: Record<string, unknown>; processed: Record<string, unknown> }[] {
  if (!config.enabled || !config.rules || config.rules.length === 0) {
    return data.slice(0, 5).map(item => ({ original: item, processed: item }));
  }

  return data.slice(0, 5).map(item => ({
    original: { ...item },
    processed: applyPreprocessToItem({ ...item }, config.rules),
  }));
}
