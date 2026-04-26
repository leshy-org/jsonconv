import {
  MergeConfig,
  MergeResult,
  FieldMapping,
} from './types';
import { applyTransform, getNestedValue, setNestedValue } from './transform';

function buildKey(item: Record<string, unknown>, mappings: FieldMapping[], side: 'left' | 'right'): string {
  const parts: string[] = [];
  for (const mapping of mappings) {
    const field = side === 'left' ? mapping.leftField : mapping.rightField;
    const transform = side === 'left' ? mapping.leftTransform : mapping.rightTransform;
    let value = getNestedValue(item, field);
    if (transform) {
      value = applyTransform(value, transform);
    }
    parts.push(String(value ?? ''));
  }
  return parts.join('\x00');
}

function pickFields(
  item: Record<string, unknown>,
  fields: string[] | undefined,
  alias: string | undefined
): Record<string, unknown> {
  if (!fields) {
    if (alias) {
      return { [alias]: { ...item } };
    }
    return { ...item };
  }

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = getNestedValue(item, field);
    if (alias) {
      setNestedValue(result, `${alias}.${field}`, value);
    } else {
      setNestedValue(result, field, value);
    }
  }
  return result;
}

function mergeObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown> | null,
  config: MergeConfig
): Record<string, unknown> {
  const leftAlias = config.leftAlias;
  const rightAlias = config.rightAlias;
  const conflictStrategy = config.conflictStrategy ?? 'prefix';

  const leftPicked = pickFields(left, config.selectFields?.left, leftAlias);
  const rightPicked = right ? pickFields(right, config.selectFields?.right, rightAlias) : {};

  if (!leftAlias && !rightAlias) {
    const result: Record<string, unknown> = {};
    const leftKeys = Object.keys(leftPicked);
    const rightKeys = Object.keys(rightPicked);
    const rightKeySet = new Set(rightKeys);

    for (const key of leftKeys) {
      if (rightKeySet.has(key) && right !== null) {
        switch (conflictStrategy) {
          case 'overwrite':
            result[key] = rightPicked[key];
            break;
          case 'skip':
            result[key] = leftPicked[key];
            break;
          case 'prefix':
            result[`left_${key}`] = leftPicked[key];
            result[`right_${key}`] = rightPicked[key];
            break;
          case 'rename':
            result[key] = leftPicked[key];
            result[`right_${key}`] = rightPicked[key];
            break;
        }
      } else {
        result[key] = leftPicked[key];
      }
    }

    for (const key of rightKeys) {
      if (!(key in result)) {
        result[key] = rightPicked[key];
      }
    }

    return result;
  }

  return { ...leftPicked, ...rightPicked };
}

export function merge(
  leftData: Record<string, unknown>[],
  rightData: Record<string, unknown>[],
  config: MergeConfig
): MergeResult {
  const rightMap = new Map<string, Record<string, unknown>[]>();

  for (const item of rightData) {
    const key = buildKey(item, config.fieldMappings, 'right');
    if (!rightMap.has(key)) {
      rightMap.set(key, []);
    }
    rightMap.get(key)!.push(item);
  }

  const matchedRightKeys = new Set<string>();
  const results: Record<string, unknown>[] = [];
  let matchCount = 0;

  for (const leftItem of leftData) {
    const key = buildKey(leftItem, config.fieldMappings, 'left');
    const rightMatches = rightMap.get(key);

    if (rightMatches && rightMatches.length > 0) {
      matchedRightKeys.add(key);
      for (const rightItem of rightMatches) {
        results.push(mergeObjects(leftItem, rightItem, config));
        matchCount++;
      }
    } else {
      if (config.mergeMode === 'left' || config.mergeMode === 'full') {
        if (config.unmatchedLeft !== 'exclude') {
          results.push(mergeObjects(leftItem, null, config));
        }
      }
    }
  }

  if (config.mergeMode === 'full' || config.mergeMode === 'right') {
    for (const [key, items] of rightMap) {
      if (!matchedRightKeys.has(key)) {
        if (config.unmatchedRight !== 'exclude') {
          for (const rightItem of items) {
            results.push(mergeObjects({}, rightItem, config));
          }
        }
      }
    }
  }

  return {
    data: results,
    stats: {
      leftTotal: leftData.length,
      rightTotal: rightData.length,
      matched: matchCount,
      unmatchedLeft: leftData.length - matchCount,
      unmatchedRight: rightData.length - matchedRightKeys.size,
      outputTotal: results.length,
    },
  };
}
