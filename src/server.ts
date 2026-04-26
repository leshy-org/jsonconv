import express from 'express';
import multer from 'multer';
import * as path from 'path';
import { merge } from './merger';
import { MergeConfig, TransformConfig, FieldMapping, FieldInfo, PreprocessConfig } from './types';
import { applyTransform, getNestedValue } from './transform';
import { applyPreprocess, previewPreprocess } from './preprocess';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({ storage: multer.memoryStorage() });

interface SessionData {
  left: unknown[];
  right: unknown[];
  leftOriginal: unknown[];
  rightOriginal: unknown[];
  leftPreprocess?: PreprocessConfig;
  rightPreprocess?: PreprocessConfig;
}

const sessions = new Map<string, SessionData>();

function buildPreviewKey(item: Record<string, unknown>, mappings: FieldMapping[], side: 'left' | 'right'): string {
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

function extractFieldsRecursive(data: unknown[], prefix: string = '', depth: number = 0): FieldInfo[] {
  if (!data || data.length === 0 || depth > 5) return [];
  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== 'object') return [];

  const fields: FieldInfo[] = [];
  for (const key of Object.keys(first)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = first[key];
    const samples = data.slice(0, 5).map((d) => (d as Record<string, unknown>)[key]);

    if (Array.isArray(val)) {
      const arr = val as unknown[];
      if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null) {
        const childFields = extractFieldsRecursive(
          arr.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null),
          '',
          depth + 1
        );
        fields.push({
          name: fullKey,
          type: 'array',
          sample: samples,
          isArray: true,
          children: childFields,
        });
      } else {
        fields.push({
          name: fullKey,
          type: 'array',
          sample: samples,
          isArray: true,
        });
      }
    } else if (val && typeof val === 'object') {
      const childFields = extractFieldsRecursive(
        data.map((d) => (d as Record<string, unknown>)[key]).filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null),
        '',
        depth + 1
      );
      fields.push({
        name: fullKey,
        type: 'object',
        sample: samples,
        children: childFields,
      });
    } else {
      let type: string = typeof val;
      if (val === null) type = 'null';
      fields.push({
        name: fullKey,
        type,
        sample: samples,
      });
    }
  }
  return fields;
}

function extractFields(data: unknown[]): FieldInfo[] {
  return extractFieldsRecursive(data);
}

function flattenFieldInfo(fields: FieldInfo[], prefix: string = ''): { name: string; type: string; sample: unknown; isArray?: boolean }[] {
  const result: { name: string; type: string; sample: unknown; isArray?: boolean }[] = [];
  for (const field of fields) {
    const fullName = prefix ? `${prefix}.${field.name}` : field.name;
    result.push({
      name: fullName,
      type: field.type,
      sample: field.sample,
      isArray: field.isArray,
    });
    if (field.children && field.children.length > 0) {
      const childPrefix = field.isArray ? `${fullName}[]` : fullName;
      result.push(...flattenFieldInfo(field.children, childPrefix));
    }
  }
  return result;
}

app.post('/api/upload', upload.fields([{ name: 'left' }, { name: 'right' }]), (req, res) => {
  try {
    const files = req.files as { left?: Express.Multer.File[]; right?: Express.Multer.File[] };
    if (!files.left || !files.right) {
      res.status(400).json({ error: '请上传左右两个JSON文件' });
      return;
    }

    const leftData = JSON.parse(files.left[0].buffer.toString('utf-8'));
    const rightData = JSON.parse(files.right[0].buffer.toString('utf-8'));

    if (!Array.isArray(leftData)) {
      res.status(400).json({ error: '左侧JSON数据不是数组' });
      return;
    }
    if (!Array.isArray(rightData)) {
      res.status(400).json({ error: '右侧JSON数据不是数组' });
      return;
    }

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessions.set(sessionId, {
      left: leftData,
      right: rightData,
      leftOriginal: leftData,
      rightOriginal: rightData,
    });

    const leftFieldsTree = extractFields(leftData);
    const rightFieldsTree = extractFields(rightData);
    const leftFields = flattenFieldInfo(leftFieldsTree);
    const rightFields = flattenFieldInfo(rightFieldsTree);

    res.json({
      sessionId,
      leftFields,
      rightFields,
      leftFieldsTree,
      rightFieldsTree,
      leftPreview: leftData.slice(0, 10),
      rightPreview: rightData.slice(0, 10),
      leftCount: leftData.length,
      rightCount: rightData.length,
    });
  } catch (err) {
    res.status(400).json({ error: '文件解析失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/preview-preprocess', (req, res) => {
  try {
    const { sessionId, side, config } = req.body as {
      sessionId: string;
      side: 'left' | 'right';
      config: PreprocessConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    const data = side === 'left' ? session.leftOriginal : session.rightOriginal;
    const previews = previewPreprocess(data as Record<string, unknown>[], config);

    res.json({ previews });
  } catch (err) {
    res.status(400).json({ error: '预览失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/apply-preprocess', (req, res) => {
  try {
    const { sessionId, leftPreprocess, rightPreprocess } = req.body as {
      sessionId: string;
      leftPreprocess?: PreprocessConfig;
      rightPreprocess?: PreprocessConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    session.leftPreprocess = leftPreprocess;
    session.rightPreprocess = rightPreprocess;

    if (leftPreprocess?.enabled) {
      session.left = applyPreprocess(session.leftOriginal as Record<string, unknown>[], leftPreprocess);
    } else {
      session.left = session.leftOriginal;
    }

    if (rightPreprocess?.enabled) {
      session.right = applyPreprocess(session.rightOriginal as Record<string, unknown>[], rightPreprocess);
    } else {
      session.right = session.rightOriginal;
    }

    const leftFieldsTree = extractFields(session.left);
    const rightFieldsTree = extractFields(session.right);
    const leftFields = flattenFieldInfo(leftFieldsTree);
    const rightFields = flattenFieldInfo(rightFieldsTree);

    res.json({
      leftFields,
      rightFields,
      leftPreview: session.left.slice(0, 10),
      rightPreview: session.right.slice(0, 10),
      leftCount: session.left.length,
      rightCount: session.right.length,
    });
  } catch (err) {
    res.status(400).json({ error: '预处理失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/preview-transform', (req, res) => {
  try {
    const { sessionId, field, side, transform } = req.body as {
      sessionId: string;
      field: string;
      side: 'left' | 'right';
      transform: TransformConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    const data = side === 'left' ? session.left : session.right;

    const samples = data.slice(0, 5).map((item) => {
      const original = getNestedValue(item as Record<string, unknown>, field);
      const transformed = applyTransform(original, transform);
      return { original, transformed };
    });

    res.json({ samples });
  } catch (err) {
    res.status(400).json({ error: '预览失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/preview-match', (req, res) => {
  try {
    const { sessionId, config } = req.body as {
      sessionId: string;
      config: MergeConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    const leftData = session.left as Record<string, unknown>[];
    const rightData = session.right as Record<string, unknown>[];

    const rightMap = new Map<string, Record<string, unknown>[]>();
    for (const item of rightData) {
      const key = buildPreviewKey(item, config.fieldMappings, 'right');
      if (!rightMap.has(key)) rightMap.set(key, []);
      rightMap.get(key)!.push(item);
    }

    const pairs: { left: Record<string, unknown>; right: Record<string, unknown> }[] = [];
    const matchedRightKeys = new Set<string>();

    for (const leftItem of leftData) {
      const key = buildPreviewKey(leftItem, config.fieldMappings, 'left');
      const rightMatches = rightMap.get(key);
      if (rightMatches && rightMatches.length > 0) {
        matchedRightKeys.add(key);
        for (const rightItem of rightMatches) {
          pairs.push({ left: leftItem, right: rightItem });
        }
      }
    }

    const limitedPairs = pairs.slice(0, 50);

    res.json({
      pairs: limitedPairs,
      stats: {
        leftTotal: leftData.length,
        rightTotal: rightData.length,
        matched: pairs.length,
        unmatchedLeft: leftData.length - new Set(leftData.map(l => buildPreviewKey(l, config.fieldMappings, 'left')).filter(k => matchedRightKeys.has(k))).size,
        unmatchedRight: rightData.length - matchedRightKeys.size,
      },
    });
  } catch (err) {
    res.status(400).json({ error: '预览失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/merge', (req, res) => {
  try {
    const { sessionId, config } = req.body as {
      sessionId: string;
      config: MergeConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    const result = merge(
      session.left as Record<string, unknown>[],
      session.right as Record<string, unknown>[],
      config
    );

    res.json({
      data: result.data.slice(0, 100),
      totalRecords: result.data.length,
      stats: result.stats,
      truncated: result.data.length > 100,
    });
  } catch (err) {
    res.status(400).json({ error: '合并失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/export', (req, res) => {
  try {
    const { sessionId, config } = req.body as {
      sessionId: string;
      config: MergeConfig;
    };

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在，请重新上传文件' });
      return;
    }

    const result = merge(
      session.left as Record<string, unknown>[],
      session.right as Record<string, unknown>[],
      config
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=merged.json');
    res.send(JSON.stringify(result.data, null, 2));
  } catch (err) {
    res.status(400).json({ error: '导出失败: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.listen(PORT, () => {
  console.log(`JSON关联合并工具已启动: http://localhost:${PORT}`);
});
