import { TransformConfig } from './types';

export function applyTransform(value: unknown, transform: TransformConfig): unknown {
  if (value === null || value === undefined) return value;

  const strValue = String(value);

  switch (transform.type) {
    case 'prefix': {
      const prefix = String(transform.args?.value ?? '');
      if (strValue.startsWith(prefix)) return strValue;
      return prefix + strValue;
    }

    case 'suffix': {
      const suffix = String(transform.args?.value ?? '');
      if (strValue.endsWith(suffix)) return strValue;
      return strValue + suffix;
    }

    case 'replace': {
      const search = String(transform.args?.search ?? '');
      const replacement = String(transform.args?.replacement ?? '');
      return strValue.split(search).join(replacement);
    }

    case 'regex': {
      const pattern = String(transform.args?.pattern ?? '');
      const flags = String(transform.args?.flags ?? 'g');
      const replacement = String(transform.args?.replacement ?? '');
      try {
        const regex = new RegExp(pattern, flags);
        return strValue.replace(regex, replacement);
      } catch {
        return strValue;
      }
    }

    case 'trim':
      return strValue.trim();

    case 'lowercase':
      return strValue.toLowerCase();

    case 'uppercase':
      return strValue.toUpperCase();

    case 'substring': {
      const start = Number(transform.args?.start ?? 0);
      const end = transform.args?.end !== undefined ? Number(transform.args?.end) : undefined;
      return end !== undefined ? strValue.substring(start, end) : strValue.substring(start);
    }

    case 'padStart': {
      const targetLength = Number(transform.args?.length ?? 0);
      const padString = String(transform.args?.fill ?? ' ');
      return strValue.padStart(targetLength, padString);
    }

    case 'padEnd': {
      const targetLength = Number(transform.args?.length ?? 0);
      const padString = String(transform.args?.fill ?? ' ');
      return strValue.padEnd(targetLength, padString);
    }

    case 'extract': {
      const pattern = String(transform.args?.pattern ?? '');
      const group = Number(transform.args?.group ?? 1);
      try {
        const regex = new RegExp(pattern);
        const match = regex.exec(strValue);
        if (match && match[group] !== undefined) {
          return match[group];
        }
        return null;
      } catch {
        return null;
      }
    }

    case 'split': {
      const separator = String(transform.args?.separator ?? ',');
      const index = Number(transform.args?.index ?? 0);
      const parts = strValue.split(separator);
      if (index >= 0 && index < parts.length) {
        return parts[index].trim();
      }
      if (index < 0) {
        const revIndex = parts.length + index;
        if (revIndex >= 0 && revIndex < parts.length) {
          return parts[revIndex].trim();
        }
      }
      return null;
    }

    case 'parseTlv': {
      const pairSeparator = String(transform.args?.pairSeparator ?? ';');
      const kvSeparator = String(transform.args?.kvSeparator ?? '=');
      const tag = String(transform.args?.tag ?? '');
      const extractPart = String(transform.args?.extract ?? 'value');
      const pairs = strValue.split(pairSeparator);
      for (const pair of pairs) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const sepIdx = trimmed.indexOf(kvSeparator);
        if (sepIdx === -1) continue;
        const pairTag = trimmed.substring(0, sepIdx).trim();
        const pairValue = trimmed.substring(sepIdx + kvSeparator.length).trim();
        if (tag && pairTag === tag) {
          if (extractPart === 'tag') return pairTag;
          if (extractPart === 'value') return pairValue;
          return pairValue;
        }
        if (!tag) {
          return extractPart === 'tag' ? pairTag : pairValue;
        }
      }
      return null;
    }

    case 'toInt': {
      const radix = Number(transform.args?.radix ?? 0);
      const trimmed = strValue.trim();
      if (trimmed === '') return null;
      try {
        if (radix === 0) {
          if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
            return parseInt(trimmed.slice(2), 16);
          }
          if (trimmed.startsWith('0b') || trimmed.startsWith('0B')) {
            return parseInt(trimmed.slice(2), 2);
          }
          if (trimmed.startsWith('0o') || trimmed.startsWith('0O')) {
            return parseInt(trimmed.slice(2), 8);
          }
          const num = Number(trimmed);
          if (isNaN(num)) return null;
          return Math.trunc(num);
        }
        let parseStr = trimmed;
        if (radix === 16 && (parseStr.startsWith('0x') || parseStr.startsWith('0X'))) {
          parseStr = parseStr.slice(2);
        } else if (radix === 2 && (parseStr.startsWith('0b') || parseStr.startsWith('0B'))) {
          parseStr = parseStr.slice(2);
        } else if (radix === 8 && (parseStr.startsWith('0o') || parseStr.startsWith('0O'))) {
          parseStr = parseStr.slice(2);
        }
        const result = parseInt(parseStr, radix);
        if (isNaN(result)) return null;
        return result;
      } catch {
        return null;
      }
    }

    case 'chain': {
      if (!transform.steps || transform.steps.length === 0) return strValue;
      let result: unknown = strValue;
      for (const step of transform.steps) {
        result = applyTransform(result, step);
        if (result === null || result === undefined) break;
      }
      return result;
    }

    case 'custom': {
      const fn = transform.args?.function as string | undefined;
      if (!fn) return strValue;
      try {
        const exec = new Function('value', fn);
        return exec(strValue);
      } catch {
        return strValue;
      }
    }

    default:
      return strValue;
  }
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
