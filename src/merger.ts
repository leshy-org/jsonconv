import {
  MergeConfig,
  MergeResult,
  FieldMapping,
  NestedMatchConfig,
} from './types';
import { applyTransform, getNestedValue, setNestedValue, getArrayValues } from './transform';

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

function mergeNestedArrays(
  leftArray: Record<string, unknown>[],
  rightArray: Record<string, unknown>[],
  nestedConfig: NestedMatchConfig,
  parentLeft: Record<string, unknown>,
  parentRight: Record<string, unknown>
): { merged: Record<string, unknown>[]; matchCount: number } {
  const rightMap = new Map<string, Record<string, unknown>[]>();
  
  for (const item of rightArray) {
    const key = buildKey(item, nestedConfig.fieldMappings, 'right');
    if (!rightMap.has(key)) {
      rightMap.set(key, []);
    }
    rightMap.get(key)!.push(item);
  }

  const results: Record<string, unknown>[] = [];
  const matchedRightKeys = new Set<string>();
  let matchCount = 0;

  for (const leftItem of leftArray) {
    const key = buildKey(leftItem, nestedConfig.fieldMappings, 'left');
    const rightMatches = rightMap.get(key);

    if (rightMatches && rightMatches.length > 0) {
      matchedRightKeys.add(key);
      for (const rightItem of rightMatches) {
        const merged = mergeNestedItem(leftItem, rightItem, nestedConfig, parentLeft, parentRight);
        results.push(merged);
        matchCount++;
      }
    } else {
      const merged = mergeNestedItem(leftItem, null, nestedConfig, parentLeft, parentRight);
      results.push(merged);
    }
  }

  for (const [key, items] of rightMap) {
    if (!matchedRightKeys.has(key)) {
      for (const rightItem of items) {
        const merged = mergeNestedItem(null, rightItem, nestedConfig, parentLeft, parentRight);
        results.push(merged);
      }
    }
  }

  return { merged: results, matchCount };
}

function mergeNestedItem(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
  nestedConfig: NestedMatchConfig,
  parentLeft: Record<string, unknown>,
  parentRight: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  if (left) {
    Object.assign(result, left);
  }
  if (right) {
    for (const [key, value] of Object.entries(right)) {
      if (key in result) {
        result[`right_${key}`] = value;
      } else {
        result[key] = value;
      }
    }
  }
  
  result['_parentLeft'] = parentLeft;
  result['_parentRight'] = parentRight;
  
  return result;
}

function flattenNestedResults(
  parentResults: Record<string, unknown>[],
  nestedConfig: NestedMatchConfig
): Record<string, unknown>[] {
  const flat: Record<string, unknown>[] = [];
  const outputArrayName = nestedConfig.outputArrayName || 'items';

  for (const parent of parentResults) {
    const nested = parent[outputArrayName];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const flatItem: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parent)) {
          if (key !== outputArrayName) {
            flatItem[key] = value;
          }
        }
        if (typeof item === 'object' && item !== null) {
          Object.assign(flatItem, item);
        }
        delete flatItem['_parentLeft'];
        delete flatItem['_parentRight'];
        flat.push(flatItem);
      }
    } else {
      delete parent['_parentLeft'];
      delete parent['_parentRight'];
      flat.push(parent);
    }
  }

  return flat;
}

export function merge(
  leftData: Record<string, unknown>[],
  rightData: Record<string, unknown>[],
  config: MergeConfig
): MergeResult {
  const nestedConfig = config.nestedMatch;
  
  if (nestedConfig && nestedConfig.enabled && nestedConfig.mode === 'independent') {
    return mergeIndependent(leftData, rightData, config, nestedConfig);
  }

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
  let nestedMatchCount = 0;

  for (const leftItem of leftData) {
    const key = buildKey(leftItem, config.fieldMappings, 'left');
    const rightMatches = rightMap.get(key);

    if (rightMatches && rightMatches.length > 0) {
      matchedRightKeys.add(key);
      for (const rightItem of rightMatches) {
        let merged = mergeObjects(leftItem, rightItem, config);
        
        if (nestedConfig && nestedConfig.enabled && nestedConfig.mode === 'parent-child') {
          const leftArray = getArrayValues(leftItem, nestedConfig.leftArrayPath);
          const rightArray = getArrayValues(rightItem, nestedConfig.rightArrayPath);
          
          if (leftArray.length > 0 || rightArray.length > 0) {
            const nestedResult = mergeNestedArrays(leftArray, rightArray, nestedConfig, leftItem, rightItem);
            const outputArrayName = nestedConfig.outputArrayName || 'items';
            
            if (nestedConfig.outputMode === 'flat') {
              for (const nestedItem of nestedResult.merged) {
                const flatItem = { ...merged };
                delete flatItem[nestedConfig.leftArrayPath];
                delete flatItem[nestedConfig.rightArrayPath];
                Object.assign(flatItem, nestedItem);
                delete flatItem['_parentLeft'];
                delete flatItem['_parentRight'];
                results.push(flatItem);
              }
              nestedMatchCount += nestedResult.matchCount;
            } else {
              merged[outputArrayName] = nestedResult.merged.map(item => {
                const cleanItem = { ...item };
                delete cleanItem['_parentLeft'];
                delete cleanItem['_parentRight'];
                return cleanItem;
              });
              delete merged[nestedConfig.leftArrayPath];
              delete merged[nestedConfig.rightArrayPath];
              results.push(merged);
              nestedMatchCount += nestedResult.matchCount;
            }
          } else {
            results.push(merged);
          }
        } else {
          results.push(merged);
        }
        matchCount++;
      }
    } else {
      if (config.mergeMode === 'left' || config.mergeMode === 'full') {
        if (config.unmatchedLeft !== 'exclude') {
          let merged = mergeObjects(leftItem, null, config);
          
          if (nestedConfig && nestedConfig.enabled && nestedConfig.mode === 'parent-child') {
            const leftArray = getArrayValues(leftItem, nestedConfig.leftArrayPath);
            if (leftArray.length > 0) {
              const outputArrayName = nestedConfig.outputArrayName || 'items';
              merged[outputArrayName] = leftArray.map(item => ({ ...item }));
              delete merged[nestedConfig.leftArrayPath];
            }
          }
          
          results.push(merged);
        }
      }
    }
  }

  if (config.mergeMode === 'full' || config.mergeMode === 'right') {
    for (const [key, items] of rightMap) {
      if (!matchedRightKeys.has(key)) {
        if (config.unmatchedRight !== 'exclude') {
          for (const rightItem of items) {
            let merged = mergeObjects({}, rightItem, config);
            
            if (nestedConfig && nestedConfig.enabled && nestedConfig.mode === 'parent-child') {
              const rightArray = getArrayValues(rightItem, nestedConfig.rightArrayPath);
              if (rightArray.length > 0) {
                const outputArrayName = nestedConfig.outputArrayName || 'items';
                merged[outputArrayName] = rightArray.map(item => ({ ...item }));
                delete merged[nestedConfig.rightArrayPath];
              }
            }
            
            results.push(merged);
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
      nestedMatched: nestedMatchCount || undefined,
    },
  };
}

function mergeIndependent(
  leftData: Record<string, unknown>[],
  rightData: Record<string, unknown>[],
  config: MergeConfig,
  nestedConfig: NestedMatchConfig
): MergeResult {
  const leftExpanded: { parent: Record<string, unknown>; item: Record<string, unknown> }[] = [];
  const rightExpanded: { parent: Record<string, unknown>; item: Record<string, unknown> }[] = [];

  for (const parent of leftData) {
    const arr = getArrayValues(parent, nestedConfig.leftArrayPath);
    if (arr.length > 0) {
      for (const item of arr) {
        leftExpanded.push({ parent, item });
      }
    }
  }

  for (const parent of rightData) {
    const arr = getArrayValues(parent, nestedConfig.rightArrayPath);
    if (arr.length > 0) {
      for (const item of arr) {
        rightExpanded.push({ parent, item });
      }
    }
  }

  const rightMap = new Map<string, { parent: Record<string, unknown>; item: Record<string, unknown> }[]>();
  for (const entry of rightExpanded) {
    const key = buildKey(entry.item, nestedConfig.fieldMappings, 'right');
    if (!rightMap.has(key)) rightMap.set(key, []);
    rightMap.get(key)!.push(entry);
  }

  const results: Record<string, unknown>[] = [];
  const matchedRightKeys = new Set<string>();
  let matchCount = 0;

  for (const leftEntry of leftExpanded) {
    const key = buildKey(leftEntry.item, nestedConfig.fieldMappings, 'left');
    const rightMatches = rightMap.get(key);

    if (rightMatches && rightMatches.length > 0) {
      matchedRightKeys.add(key);
      for (const rightEntry of rightMatches) {
        const merged = mergeObjects(leftEntry.item, rightEntry.item, config);
        
        if (nestedConfig.outputMode === 'flat') {
          const flatItem: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(leftEntry.parent)) {
            if (k !== nestedConfig.leftArrayPath) flatItem[`left_${k}`] = v;
          }
          for (const [k, v] of Object.entries(rightEntry.parent)) {
            if (k !== nestedConfig.rightArrayPath) flatItem[`right_${k}`] = v;
          }
          Object.assign(flatItem, merged);
          results.push(flatItem);
        } else {
          results.push(merged);
        }
        matchCount++;
      }
    }
  }

  return {
    data: results,
    stats: {
      leftTotal: leftData.length,
      rightTotal: rightData.length,
      matched: matchCount,
      unmatchedLeft: leftExpanded.length - matchCount,
      unmatchedRight: rightExpanded.length - matchedRightKeys.size,
      outputTotal: results.length,
      nestedMatched: matchCount,
    },
  };
}
