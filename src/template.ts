import {
  JsonTemplate,
  TemplateField,
  TemplateDiff,
  TemplateValidationResult,
  FieldConstraints,
} from './types';

export function generateTemplate(
  data: Record<string, unknown>[],
  name: string = 'Generated Template',
  description: string = ''
): JsonTemplate {
  const fields = extractTemplateFields(data);
  const now = new Date().toISOString();

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    name,
    description: description || `从 ${data.length} 条记录生成的模板`,
    fields,
    createdAt: now,
    updatedAt: now,
  };
}

function extractTemplateFields(
  data: Record<string, unknown>[]
): TemplateField[] {
  if (!data || data.length === 0) return [];

  const fieldMap = new Map<string, TemplateField>();

  for (const item of data) {
    extractFieldsRecursive(item, '', fieldMap);
  }

  return Array.from(fieldMap.values());
}

function extractFieldsRecursive(
  obj: unknown,
  prefix: string,
  fieldMap: Map<string, TemplateField>
): void {
  if (!obj || typeof obj !== 'object') return;

  const record = obj as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        const existing = fieldMap.get(path);
        if (!existing) {
          fieldMap.set(path, {
            path,
            type: 'array',
            required: true,
            description: `数组字段，包含 ${value.length} 个元素`,
            sampleValue: value.slice(0, 2),
          });
        }
        for (const item of value) {
          extractFieldsRecursive(item, `${path}[]`, fieldMap);
        }
      } else {
        const existing = fieldMap.get(path);
        if (!existing) {
          fieldMap.set(path, {
            path,
            type: 'array',
            required: true,
            description: '数组字段',
            sampleValue: value.slice(0, 3),
          });
        } else if (existing.sampleValue === undefined) {
          existing.sampleValue = value.slice(0, 3);
        }
      }
    } else if (value && typeof value === 'object') {
      extractFieldsRecursive(value, path, fieldMap);
    } else {
      const type = getValueType(value);
      const existing = fieldMap.get(path);

      if (!existing) {
        fieldMap.set(path, {
          path,
          type,
          required: true,
          description: generateFieldDescription(key, type, value),
          sampleValue: value,
          constraints: inferConstraints(value, type),
        });
      } else {
        if (existing.sampleValue === undefined && value !== undefined) {
          existing.sampleValue = value;
        }
        if (existing.type !== type && existing.type !== 'mixed') {
          existing.type = 'mixed';
        }
      }
    }
  }
}

function getValueType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function generateFieldDescription(
  key: string,
  type: string,
  value: unknown
): string {
  const keyLower = key.toLowerCase();
  
  if (keyLower.includes('id') || keyLower.endsWith('no')) {
    return '唯一标识符';
  }
  if (keyLower.includes('name')) {
    return '名称字段';
  }
  if (keyLower.includes('time') || keyLower.includes('date')) {
    return '时间日期字段';
  }
  if (keyLower.includes('status')) {
    return '状态字段';
  }
  if (keyLower.includes('desc') || keyLower.includes('description')) {
    return '描述字段';
  }
  if (keyLower.includes('count') || keyLower.includes('qty') || keyLower.includes('num')) {
    return '数量字段';
  }
  if (keyLower.includes('price') || keyLower.includes('amount') || keyLower.includes('cost')) {
    return '金额字段';
  }

  return `${type} 类型字段`;
}

function inferConstraints(value: unknown, type: string): FieldConstraints | undefined {
  if (type === 'string' && typeof value === 'string') {
    return {
      minLength: 0,
      maxLength: Math.max(value.length * 2, 100),
    };
  }
  if (type === 'number' && typeof value === 'number') {
    return {
      min: 0,
      max: Math.ceil(Math.abs(value) * 10),
    };
  }
  return undefined;
}

export function validateAgainstTemplate(
  data: Record<string, unknown>[],
  template: JsonTemplate
): TemplateValidationResult {
  const diffs: TemplateDiff[] = [];
  let matchCount = 0;
  let missingCount = 0;
  let extraCount = 0;
  let violationCount = 0;

  const templatePaths = new Set(template.fields.map(f => f.path));

  for (const item of data) {
    const dataPaths = new Set<string>();
    collectPaths(item, '', dataPaths);

    for (const field of template.fields) {
      const value = getNestedValue(item, field.path);
      const exists = dataPaths.has(field.path);

      if (!exists && field.required) {
        diffs.push({
          path: field.path,
          status: 'missing',
          expected: field.type,
          message: `缺少必需字段: ${field.path}`,
        });
        missingCount++;
      } else if (exists) {
        const actualType = getValueType(value);
        
        if (actualType !== field.type && field.type !== 'mixed') {
          diffs.push({
            path: field.path,
            status: 'type_mismatch',
            expected: field.type,
            actual: actualType,
            message: `类型不匹配: 期望 ${field.type}, 实际 ${actualType}`,
          });
          violationCount++;
        } else {
          const constraintResult = validateConstraints(value, field);
          if (!constraintResult.valid) {
            diffs.push({
              path: field.path,
              status: 'constraint_violation',
              message: constraintResult.message || '约束条件不满足',
            });
            violationCount++;
          } else {
            matchCount++;
          }
        }
      }
    }

    for (const dataPath of dataPaths) {
      if (!templatePaths.has(dataPath)) {
        diffs.push({
          path: dataPath,
          status: 'extra',
          actual: 'field',
          message: `多余字段: ${dataPath}`,
        });
        extraCount++;
      }
    }
  }

  return {
    isValid: missingCount === 0 && violationCount === 0,
    matchCount,
    missingCount,
    extraCount,
    violationCount,
    diffs,
  };
}

function collectPaths(
  obj: unknown,
  prefix: string,
  paths: Set<string>
): void {
  if (!obj || typeof obj !== 'object') return;

  const record = obj as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.add(path);

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      for (const item of value) {
        collectPaths(item, `${path}[]`, paths);
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectPaths(value, path, paths);
    }
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[\]/g, '.0').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      current = current[idx];
    } else {
      return undefined;
    }
  }

  return current;
}

function validateConstraints(
  value: unknown,
  field: TemplateField
): { valid: boolean; message?: string } {
  const constraints = field.constraints;
  if (!constraints) return { valid: true };

  if (typeof value === 'string') {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      return { valid: false, message: `长度小于最小值 ${constraints.minLength}` };
    }
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      return { valid: false, message: `长度超过最大值 ${constraints.maxLength}` };
    }
    if (constraints.pattern) {
      const regex = new RegExp(constraints.pattern);
      if (!regex.test(value)) {
        return { valid: false, message: `不匹配模式 ${constraints.pattern}` };
      }
    }
    if (constraints.enum && !constraints.enum.includes(value)) {
      return { valid: false, message: `值不在枚举列表中` };
    }
  }

  if (typeof value === 'number') {
    if (constraints.min !== undefined && value < constraints.min) {
      return { valid: false, message: `值小于最小值 ${constraints.min}` };
    }
    if (constraints.max !== undefined && value > constraints.max) {
      return { valid: false, message: `值超过最大值 ${constraints.max}` };
    }
  }

  return { valid: true };
}

export function updateTemplateFromData(
  template: JsonTemplate,
  data: Record<string, unknown>[]
): JsonTemplate {
  const newFields = extractTemplateFields(data);
  const existingPaths = new Set(template.fields.map(f => f.path));

  for (const field of newFields) {
    if (!existingPaths.has(field.path)) {
      template.fields.push({
        ...field,
        required: false,
        description: field.description + ' (新增)',
      });
    }
  }

  template.updatedAt = new Date().toISOString();
  return template;
}

export function mergeTemplates(
  template1: JsonTemplate,
  template2: JsonTemplate
): JsonTemplate {
  const fieldMap = new Map<string, TemplateField>();

  for (const field of template1.fields) {
    fieldMap.set(field.path, { ...field });
  }

  for (const field of template2.fields) {
    const existing = fieldMap.get(field.path);
    if (!existing) {
      fieldMap.set(field.path, { ...field, required: false });
    } else {
      existing.required = existing.required && field.required;
      if (!existing.description && field.description) {
        existing.description = field.description;
      }
    }
  }

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    name: `${template1.name} + ${template2.name}`,
    description: '合并生成的模板',
    fields: Array.from(fieldMap.values()),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
