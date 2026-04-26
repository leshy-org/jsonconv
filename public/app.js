const TRANSFORM_TYPES = [
  { value: '', label: '无转换' },
  { value: 'prefix', label: '添加前缀' },
  { value: 'suffix', label: '添加后缀' },
  { value: 'replace', label: '字符串替换' },
  { value: 'regex', label: '正则替换' },
  { value: 'trim', label: '去除空格' },
  { value: 'lowercase', label: '转小写' },
  { value: 'uppercase', label: '转大写' },
  { value: 'padStart', label: '前补位' },
  { value: 'padEnd', label: '后补位' },
  { value: 'substring', label: '截取子串' },
  { value: 'extract', label: '正则提取' },
  { value: 'split', label: '分隔拆取' },
  { value: 'parseTlv', label: 'TLV解析' },
  { value: 'toInt', label: '转整数' },
  { value: 'chain', label: '链式组合' },
  { value: 'custom', label: '自定义函数' },
];

const TRANSFORM_ARGS = {
  prefix: [{ key: 'value', label: '前缀值' }],
  suffix: [{ key: 'value', label: '后缀值' }],
  replace: [
    { key: 'search', label: '搜索' },
    { key: 'replacement', label: '替换为' },
  ],
  regex: [
    { key: 'pattern', label: '正则' },
    { key: 'flags', label: '标志' },
    { key: 'replacement', label: '替换为' },
  ],
  trim: [],
  lowercase: [],
  uppercase: [],
  padStart: [
    { key: 'length', label: '长度' },
    { key: 'fill', label: '填充' },
  ],
  padEnd: [
    { key: 'length', label: '长度' },
    { key: 'fill', label: '填充' },
  ],
  substring: [
    { key: 'start', label: '起始' },
    { key: 'end', label: '结束' },
  ],
  extract: [
    { key: 'pattern', label: '正则(含组)' },
    { key: 'group', label: '组号' },
  ],
  split: [
    { key: 'separator', label: '分隔符' },
    { key: 'index', label: '段序号' },
  ],
  parseTlv: [
    { key: 'pairSeparator', label: '对分隔符' },
    { key: 'kvSeparator', label: 'KV分隔符' },
    { key: 'tag', label: 'Tag' },
    { key: 'extract', label: '提取' },
  ],
  toInt: [
    { key: 'radix', label: '进制(0自动)' },
  ],
  chain: [],
  custom: [{ key: 'function', label: '函数体' }],
};

let state = {
  sessionId: null,
  leftFields: [],
  rightFields: [],
  leftData: [],
  rightData: [],
  leftCount: 0,
  rightCount: 0,
  mappings: [{ leftField: '', rightField: '', leftTransform: null, rightTransform: null }],
  matchPairs: [],
  matchIndex: -1,
  mergeResult: null,
  activeMappingIndex: -1,
  nested: {
    enabled: false,
    mode: 'parent-child',
    leftArrayPath: '',
    rightArrayPath: '',
    outputMode: 'nested',
    outputArrayName: 'items',
    mappings: [{ leftField: '', rightField: '', leftTransform: null, rightTransform: null }],
  },
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showToast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderJsonToHtml(data, highlightKeys, activeKey) {
  const json = JSON.stringify(data, null, 2);
  const highlightSet = new Set(highlightKeys || []);
  const lines = json.split('\n');
  return lines.map(line => {
    const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:\s*)/);
    if (keyMatch) {
      const [, indent, key, colon] = keyMatch;
      const isHighlight = highlightSet.has(key);
      const isActive = key === activeKey;
      const cls = isActive ? 'hl-active' : (isHighlight ? 'hl-match' : '');
      const keySpan = cls
        ? `<span class="hl-key ${cls}">"${escapeHtml(key)}"</span>`
        : `<span class="hl-key">"${escapeHtml(key)}"</span>`;
      const rest = line.substring(indent.length + key.length + 4 + colon.length);
      const valueHtml = highlightJsonValue(rest, isHighlight || isActive);
      return indent + keySpan + colon + valueHtml;
    }
    const valOnly = line.match(/^\s*(.*)/);
    if (valOnly) {
      return line.replace(valOnly[1], highlightJsonValue(valOnly[1], false));
    }
    return escapeHtml(line);
  }).join('\n');
}

function highlightJsonValue(valStr, highlight) {
  const trimmed = valStr.trim();
  if (!trimmed) return escapeHtml(valStr);
  const cls = highlight ? 'hl-match' : '';
  if (trimmed.startsWith('"')) {
    const end = trimmed.lastIndexOf('"');
    if (end > 0) {
      const strVal = trimmed.substring(1, end);
      const rest = trimmed.substring(end + 1);
      return `<span class="hl-string ${cls}">"${escapeHtml(strVal)}"</span>${escapeHtml(rest)}`;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed.replace(/[,]\s*$/, ''))) {
    return `<span class="hl-number ${cls}">${escapeHtml(valStr)}</span>`;
  }
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') {
    return `<span class="hl-number ${cls}">${escapeHtml(valStr)}</span>`;
  }
  return escapeHtml(valStr);
}

function getHighlightFields(side) {
  const keys = [];
  state.mappings.forEach(m => {
    if (side === 'left' && m.leftField) keys.push(m.leftField);
    if (side === 'right' && m.rightField) keys.push(m.rightField);
  });
  return keys;
}

function getActiveField(side) {
  if (state.activeMappingIndex < 0) return null;
  const m = state.mappings[state.activeMappingIndex];
  if (!m) return null;
  return side === 'left' ? m.leftField : m.rightField;
}

function renderJsonViews() {
  const leftHighlight = getHighlightFields('left');
  const rightHighlight = getHighlightFields('right');
  const leftActive = getActiveField('left');
  const rightActive = getActiveField('right');

  const leftData = state.leftData.slice(0, 3);
  const rightData = state.rightData.slice(0, 3);

  $('#leftJsonView').innerHTML = renderJsonToHtml(leftData, leftHighlight, leftActive);
  $('#rightJsonView').innerHTML = renderJsonToHtml(rightData, rightHighlight, rightActive);
  $('#leftCount').textContent = state.leftCount + ' 条记录';
  $('#rightCount').textContent = state.rightCount + ' 条记录';
}

function renderFieldMappings() {
  const container = $('#fieldMappings');
  container.innerHTML = '';

  state.mappings.forEach((mapping, i) => {
    const row = document.createElement('div');
    row.className = 'mapping-row' + (i === state.activeMappingIndex ? ' active' : '');
    row.dataset.index = i;

    const leftTransformType = mapping.leftTransform?.type || '';
    const rightTransformType = mapping.rightTransform?.type || '';

    row.innerHTML = `
      <div class="mapping-side">
        <label>左侧字段</label>
        <select data-side="left" data-index="${i}" class="field-select">
          <option value="">-- 选择 --</option>
          ${state.leftFields.map(f =>
            `<option value="${escapeHtml(f.name)}" ${f.name === mapping.leftField ? 'selected' : ''}>${escapeHtml(f.name)} (${f.type})</option>`
          ).join('')}
        </select>
        <div class="transform-inline">
          <select data-side="left" data-index="${i}" class="transform-select">
            ${TRANSFORM_TYPES.map(t =>
              `<option value="${t.value}" ${t.value === leftTransformType ? 'selected' : ''}>${t.label}</option>`
            ).join('')}
          </select>
          <span class="transform-args-inline" id="targs_left_${i}"></span>
        </div>
        <div class="transform-preview" id="tprev_left_${i}"></div>
      </div>
      <div class="arrow">⟷</div>
      <div class="mapping-side">
        <label>右侧字段</label>
        <select data-side="right" data-index="${i}" class="field-select">
          <option value="">-- 选择 --</option>
          ${state.rightFields.map(f =>
            `<option value="${escapeHtml(f.name)}" ${f.name === mapping.rightField ? 'selected' : ''}>${escapeHtml(f.name)} (${f.type})</option>`
          ).join('')}
        </select>
        <div class="transform-inline">
          <select data-side="right" data-index="${i}" class="transform-select">
            ${TRANSFORM_TYPES.map(t =>
              `<option value="${t.value}" ${t.value === rightTransformType ? 'selected' : ''}>${t.label}</option>`
            ).join('')}
          </select>
          <span class="transform-args-inline" id="targs_right_${i}"></span>
        </div>
        <div class="transform-preview" id="tprev_right_${i}"></div>
      </div>
      <button class="remove-btn" data-index="${i}" title="删除">✕</button>
    `;
    container.appendChild(row);

    renderInlineTransformArgs('left', i);
    renderInlineTransformArgs('right', i);
  });

  container.querySelectorAll('.field-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.index);
      const side = e.target.dataset.side;
      state.mappings[idx][side + 'Field'] = e.target.value;
      state.activeMappingIndex = idx;
      renderJsonViews();
      renderFieldMappings();
      updateSummaryPreview();
    });
    sel.addEventListener('focus', e => {
      const idx = parseInt(e.target.dataset.index);
      state.activeMappingIndex = idx;
      renderJsonViews();
    });
  });

  container.querySelectorAll('.transform-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.index);
      const side = e.target.dataset.side;
      const type = e.target.value;
      if (!state.mappings[idx][side + 'Transform']) {
        state.mappings[idx][side + 'Transform'] = { type: '', args: {} };
      }
      state.mappings[idx][side + 'Transform'].type = type;
      state.mappings[idx][side + 'Transform'].args = {};
      if (type === 'chain') {
        state.mappings[idx][side + 'Transform'].steps = [{ type: 'trim', args: {} }];
      }
      renderInlineTransformArgs(side, idx);
      previewTransformInline(side, idx);
      updateSummaryPreview();
    });
  });

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.index);
      if (state.mappings.length > 1) {
        state.mappings.splice(idx, 1);
        if (state.activeMappingIndex >= state.mappings.length) {
          state.activeMappingIndex = state.mappings.length - 1;
        }
        renderFieldMappings();
        renderJsonViews();
        updateSummaryPreview();
      }
    });
  });

  container.querySelectorAll('.mapping-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      const idx = parseInt(row.dataset.index);
      state.activeMappingIndex = idx;
      renderJsonViews();
      container.querySelectorAll('.mapping-row').forEach((r, ri) => {
        r.classList.toggle('active', ri === idx);
      });
    });
  });
}

function renderInlineTransformArgs(side, index) {
  const container = $(`#targs_${side}_${index}`);
  if (!container) return;

  const mapping = state.mappings[index];
  const transform = mapping[side + 'Transform'];
  if (!transform || !transform.type || transform.type === 'chain') {
    if (transform && transform.type === 'chain') {
      renderChainInline(side, index, container);
    } else {
      container.innerHTML = '';
    }
    return;
  }

  const argDefs = TRANSFORM_ARGS[transform.type] || [];
  if (argDefs.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = argDefs.map(arg =>
    `<input type="text" data-side="${side}" data-index="${index}" data-arg="${arg.key}"
            value="${escapeHtml(transform.args?.[arg.key] || '')}"
            placeholder="${arg.label}" class="targ-input">`
  ).join('');

  container.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.index);
      const s = e.target.dataset.side;
      const argKey = e.target.dataset.arg;
      if (!state.mappings[idx][s + 'Transform']) {
        state.mappings[idx][s + 'Transform'] = { type: '', args: {} };
      }
      state.mappings[idx][s + 'Transform'].args[argKey] = e.target.value;
      previewTransformInline(s, idx);
      updateSummaryPreview();
    });
  });
}

function renderChainInline(side, index, container) {
  const transform = state.mappings[index][side + 'Transform'];
  if (!transform) return;
  const steps = transform.steps || [];

  let html = '<div class="chain-inline">';
  steps.forEach((step, si) => {
    html += `<div class="chain-step-row">
      <select data-side="${side}" data-index="${index}" data-step="${si}" class="chain-type-sel">
        ${TRANSFORM_TYPES.filter(t => t.value && t.value !== 'chain').map(t =>
          `<option value="${t.value}" ${t.value === step.type ? 'selected' : ''}>${t.label}</option>`
        ).join('')}
      </select>
      ${(TRANSFORM_ARGS[step.type] || []).map(arg =>
        `<input type="text" data-side="${side}" data-index="${index}" data-step="${si}" data-arg="${arg.key}"
               value="${escapeHtml(step.args?.[arg.key] || '')}" placeholder="${arg.label}" class="chain-arg-input">`
      ).join('')}
      <button class="remove-btn chain-rm" data-side="${side}" data-index="${index}" data-step="${si}">✕</button>
    </div>`;
  });
  html += `<button class="chain-add" data-side="${side}" data-index="${index}">+步骤</button></div>`;
  container.innerHTML = html;

  container.querySelectorAll('.chain-type-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const si = parseInt(e.target.dataset.step);
      transform.steps[si].type = e.target.value;
      transform.steps[si].args = {};
      renderChainInline(side, index, container);
      previewTransformInline(side, index);
      updateSummaryPreview();
    });
  });

  container.querySelectorAll('.chain-arg-input').forEach(input => {
    input.addEventListener('input', e => {
      const si = parseInt(e.target.dataset.step);
      transform.steps[si].args[e.target.dataset.arg] = e.target.value;
      previewTransformInline(side, index);
      updateSummaryPreview();
    });
  });

  container.querySelectorAll('.chain-rm').forEach(btn => {
    btn.addEventListener('click', e => {
      const si = parseInt(e.target.dataset.step);
      transform.steps.splice(si, 1);
      renderChainInline(side, index, container);
      previewTransformInline(side, index);
      updateSummaryPreview();
    });
  });

  container.querySelectorAll('.chain-add').forEach(btn => {
    btn.addEventListener('click', () => {
      transform.steps.push({ type: 'trim', args: {} });
      renderChainInline(side, index, container);
    });
  });
}

async function previewTransformInline(side, index) {
  const mapping = state.mappings[index];
  const transform = mapping[side + 'Transform'];
  const field = side === 'left' ? mapping.leftField : mapping.rightField;
  if (!transform || !transform.type || !field) return;

  try {
    const res = await fetch('/api/preview-transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, field, side, transform }),
    });
    const data = await res.json();
    if (!res.ok) return;

    const previewEl = $(`#tprev_${side}_${index}`);
    if (previewEl && data.samples) {
      const validSamples = data.samples.filter(s => s.original !== undefined && s.original !== null);
      if (validSamples.length > 0) {
        const s = validSamples[0];
        previewEl.textContent = `${JSON.stringify(s.original)} → ${JSON.stringify(s.transformed)}`;
      } else {
        previewEl.textContent = '';
      }
    }
  } catch {}
}

function autoDetectMappings() {
  state.mappings = [];
  for (const lf of state.leftFields) {
    const ln = lf.name.toLowerCase();
    for (const rf of state.rightFields) {
      const rn = rf.name.toLowerCase();
      if (ln === rn || ln === rn.replace('id', 'no') || rn === ln.replace('id', 'no')) {
        state.mappings.push({
          leftField: lf.name,
          rightField: rf.name,
          leftTransform: null,
          rightTransform: null,
        });
      }
    }
  }
  if (state.mappings.length === 0) {
    state.mappings.push({
      leftField: state.leftFields[0]?.name || '',
      rightField: state.rightFields[0]?.name || '',
      leftTransform: null,
      rightTransform: null,
    });
  }
  state.activeMappingIndex = 0;
}

function getArrayFields(fields) {
  return fields.filter(f => f.isArray);
}

function renderNestedConfig() {
  const leftArrayFields = getArrayFields(state.leftFields);
  const rightArrayFields = getArrayFields(state.rightFields);

  const leftSelect = $('#nestedLeftArray');
  const rightSelect = $('#nestedRightArray');

  leftSelect.innerHTML = '<option value="">-- 选择 --</option>' +
    leftArrayFields.map(f => `<option value="${escapeHtml(f.name)}" ${f.name === state.nested.leftArrayPath ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');

  rightSelect.innerHTML = '<option value="">-- 选择 --</option>' +
    rightArrayFields.map(f => `<option value="${escapeHtml(f.name)}" ${f.name === state.nested.rightArrayPath ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');

  renderNestedFieldMappings();
}

function renderNestedFieldMappings() {
  const container = $('#nestedFieldMappings');
  if (!container) return;
  container.innerHTML = '';

  state.nested.mappings.forEach((mapping, i) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    row.innerHTML = `
      <div class="mapping-side">
        <label>左子字段</label>
        <select data-nested="true" data-side="left" data-index="${i}" class="field-select">
          <option value="">-- 选择 --</option>
          ${state.leftFields.map(f =>
            `<option value="${escapeHtml(f.name)}" ${f.name === mapping.leftField ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="arrow">⟷</div>
      <div class="mapping-side">
        <label>右子字段</label>
        <select data-nested="true" data-side="right" data-index="${i}" class="field-select">
          <option value="">-- 选择 --</option>
          ${state.rightFields.map(f =>
            `<option value="${escapeHtml(f.name)}" ${f.name === mapping.rightField ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
          ).join('')}
        </select>
      </div>
      <button class="remove-btn" data-nested="true" data-index="${i}" title="删除">✕</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('.field-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.index);
      const side = e.target.dataset.side;
      state.nested.mappings[idx][side + 'Field'] = e.target.value;
      updateSummaryPreview();
    });
  });

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.index);
      if (state.nested.mappings.length > 1) {
        state.nested.mappings.splice(idx, 1);
        renderNestedFieldMappings();
        updateSummaryPreview();
      }
    });
  });
}

function buildConfig() {
  const fieldMappings = state.mappings.map(m => {
    const mapping = {
      leftField: m.leftField,
      rightField: m.rightField,
    };
    if (m.leftTransform && m.leftTransform.type) mapping.leftTransform = m.leftTransform;
    if (m.rightTransform && m.rightTransform.type) mapping.rightTransform = m.rightTransform;
    return mapping;
  });

  const config = {
    leftFile: '',
    rightFile: '',
    outputFile: 'output.json',
    fieldMappings,
    mergeMode: $('#mergeMode').value,
    leftAlias: $('#leftAlias').value || undefined,
    rightAlias: $('#rightAlias').value || undefined,
    conflictStrategy: $('#conflictStrategy').value,
    unmatchedLeft: $('#unmatchedLeft').value,
    unmatchedRight: $('#unmatchedRight').value,
  };

  if (state.nested.enabled && state.nested.leftArrayPath && state.nested.rightArrayPath) {
    config.nestedMatch = {
      enabled: true,
      mode: state.nested.mode,
      leftArrayPath: state.nested.leftArrayPath,
      rightArrayPath: state.nested.rightArrayPath,
      outputMode: state.nested.outputMode,
      outputArrayName: state.nested.outputArrayName || 'items',
      fieldMappings: state.nested.mappings.filter(m => m.leftField && m.rightField).map(m => ({
        leftField: m.leftField,
        rightField: m.rightField,
      })),
    };
  }

  return config;
}

async function previewMatch() {
  const valid = state.mappings.some(m => m.leftField && m.rightField);
  if (!valid) {
    showToast('请至少选择一对匹配字段');
    return;
  }

  const config = buildConfig();
  try {
    const res = await fetch('/api/preview-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, config }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    state.matchPairs = data.pairs || [];
    state.matchIndex = state.matchPairs.length > 0 ? 0 : -1;

    renderMatchStats(data.stats);
    showCurrentMatch();
  } catch (err) {
    showToast(err.message);
  }
}

function renderMatchStats(stats) {
  const container = $('#matchStats');
  if (!stats) {
    container.innerHTML = '';
    return;
  }
  let html = `
    <div class="stat-item">左侧: ${stats.leftTotal}</div>
    <div class="stat-item">右侧: ${stats.rightTotal}</div>
    <div class="stat-item success">匹配: ${stats.matched}</div>
    <div class="stat-item warning">左未匹配: ${stats.unmatchedLeft}</div>
    <div class="stat-item warning">右未匹配: ${stats.unmatchedRight}</div>
  `;
  if (stats.nestedMatched !== undefined) {
    html += `<div class="stat-item">嵌套匹配: ${stats.nestedMatched}</div>`;
  }
  container.innerHTML = html;
}

function showCurrentMatch() {
  if (state.matchPairs.length === 0 || state.matchIndex < 0) {
    $('#leftJsonView').innerHTML = renderJsonToHtml(state.leftData.slice(0, 3), getHighlightFields('left'), getActiveField('left'));
    $('#rightJsonView').innerHTML = renderJsonToHtml(state.rightData.slice(0, 3), getHighlightFields('right'), getActiveField('right'));
    return;
  }

  const pair = state.matchPairs[state.matchIndex];
  const leftHighlight = getHighlightFields('left');
  const rightHighlight = getHighlightFields('right');
  const leftActive = getActiveField('left');
  const rightActive = getActiveField('right');

  $('#leftJsonView').innerHTML = renderJsonToHtml(pair.left, leftHighlight, leftActive);
  $('#rightJsonView').innerHTML = renderJsonToHtml(pair.right, rightHighlight, rightActive);

  const nav = $('#matchNav');
  if (nav) {
    nav.textContent = `${state.matchIndex + 1} / ${state.matchPairs.length}`;
  }
}

function nextMatch() {
  if (state.matchPairs.length === 0) return;
  state.matchIndex = (state.matchIndex + 1) % state.matchPairs.length;
  showCurrentMatch();
}

function prevMatch() {
  if (state.matchPairs.length === 0) return;
  state.matchIndex = (state.matchIndex - 1 + state.matchPairs.length) % state.matchPairs.length;
  showCurrentMatch();
}

async function updateSummaryPreview() {
  const valid = state.mappings.some(m => m.leftField && m.rightField);
  if (!valid) {
    $('#summaryPreview').innerHTML = renderJsonToHtml([], [], null);
    $('#previewNote').textContent = '请选择匹配字段';
    return;
  }

  const config = buildConfig();
  try {
    const res = await fetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, config }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('#summaryPreview').innerHTML = '';
      $('#previewNote').textContent = '配置有误';
      return;
    }

    state.mergeResult = data;
    const previewData = data.data.slice(0, 2);
    $('#summaryPreview').innerHTML = renderJsonToHtml(previewData, [], null);
    $('#previewNote').textContent = data.truncated
      ? `前2条预览，共${data.totalRecords}条`
      : `共${data.totalRecords}条`;

    renderMatchStats(data.stats);
  } catch {
    $('#summaryPreview').innerHTML = '';
    $('#previewNote').textContent = '';
  }
}

async function doMerge() {
  const valid = state.mappings.every(m => m.leftField && m.rightField);
  if (!valid) {
    showToast('请为所有匹配条件选择字段');
    return;
  }

  const config = buildConfig();
  try {
    const res = await fetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, config }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    state.mergeResult = data;
    const previewData = data.data.slice(0, 5);
    $('#summaryPreview').innerHTML = renderJsonToHtml(previewData, [], null);
    $('#previewNote').textContent = data.truncated
      ? `前5条预览，共${data.totalRecords}条`
      : `共${data.totalRecords}条`;

    renderMatchStats(data.stats);
    $('#btnExport').style.display = '';
    $('#btnCopy').style.display = '';
    showToast('合并完成！', 'success');
  } catch (err) {
    showToast(err.message);
  }
}

async function exportResult() {
  const config = buildConfig();
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, config }),
    });
    if (!res.ok) throw new Error('导出失败');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('文件已下载', 'success');
  } catch (err) {
    showToast(err.message);
  }
}

function copyResult() {
  if (!state.mergeResult) return;
  const text = JSON.stringify(state.mergeResult.data, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    showToast('复制失败');
  });
}

function initUpload() {
  const leftFile = $('#leftFile');
  const rightFile = $('#rightFile');
  const leftDrop = $('#leftDrop');
  const rightDrop = $('#rightDrop');
  const btnUpload = $('#btnUpload');

  function checkReady() {
    btnUpload.disabled = !(leftFile.files.length && rightFile.files.length);
  }

  leftFile.addEventListener('change', () => {
    $('#leftFileName').textContent = leftFile.files[0]?.name || '';
    leftDrop.classList.toggle('uploaded', !!leftFile.files.length);
    checkReady();
  });

  rightFile.addEventListener('change', () => {
    $('#rightFileName').textContent = rightFile.files[0]?.name || '';
    rightDrop.classList.toggle('uploaded', !!rightFile.files.length);
    checkReady();
  });

  [leftDrop, rightDrop].forEach(drop => {
    const input = drop.querySelector('input');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  });

  btnUpload.addEventListener('click', async () => {
    const formData = new FormData();
    formData.append('left', leftFile.files[0]);
    formData.append('right', rightFile.files[0]);

    btnUpload.disabled = true;
    btnUpload.textContent = '上传中...';

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      state.sessionId = data.sessionId;
      state.leftFields = data.leftFields;
      state.rightFields = data.rightFields;
      state.leftData = data.leftPreview;
      state.rightData = data.rightPreview;
      state.leftCount = data.leftCount;
      state.rightCount = data.rightCount;
      state.mergeResult = null;
      state.matchPairs = [];
      state.matchIndex = -1;
      state.nested = {
        enabled: false,
        mode: 'parent-child',
        leftArrayPath: '',
        rightArrayPath: '',
        outputMode: 'nested',
        outputArrayName: 'items',
        mappings: [{ leftField: '', rightField: '', leftTransform: null, rightTransform: null }],
      };

      autoDetectMappings();
      renderFieldMappings();
      renderJsonViews();
      renderNestedConfig();
      updateSummaryPreview();

      $('#step1').classList.add('hidden');
      $('#step2').classList.remove('hidden');
      showToast('文件上传成功！', 'success');
    } catch (err) {
      showToast(err.message);
    } finally {
      btnUpload.disabled = false;
      btnUpload.textContent = '上传并解析 →';
    }
  });
}

function initNavigation() {
  $('#btnAddMapping').addEventListener('click', () => {
    state.mappings.push({ leftField: '', rightField: '', leftTransform: null, rightTransform: null });
    renderFieldMappings();
  });

  $('#btnBack1').addEventListener('click', () => {
    $('#step2').classList.add('hidden');
    $('#step1').classList.remove('hidden');
  });

  $('#btnMerge').addEventListener('click', doMerge);
  $('#btnExport').addEventListener('click', exportResult);
  $('#btnCopy').addEventListener('click', copyResult);

  const btnNextMatch = $('#btnNextMatch');
  const btnPrevMatch = $('#btnPrevMatch');
  const btnPreviewMatch = $('#btnPreviewMatch');
  if (btnNextMatch) btnNextMatch.addEventListener('click', nextMatch);
  if (btnPrevMatch) btnPrevMatch.addEventListener('click', prevMatch);
  if (btnPreviewMatch) btnPreviewMatch.addEventListener('click', previewMatch);

  $('#mergeMode').addEventListener('change', updateSummaryPreview);
  $('#leftAlias').addEventListener('input', debounce(updateSummaryPreview, 500));
  $('#rightAlias').addEventListener('input', debounce(updateSummaryPreview, 500));
  $('#conflictStrategy').addEventListener('change', updateSummaryPreview);
  $('#unmatchedLeft').addEventListener('change', updateSummaryPreview);
  $('#unmatchedRight').addEventListener('change', updateSummaryPreview);

  initNestedControls();
}

function initNestedControls() {
  const nestedEnabled = $('#nestedEnabled');
  const nestedConfig = $('#nestedConfig');

  nestedEnabled.addEventListener('change', e => {
    state.nested.enabled = e.target.checked;
    nestedConfig.classList.toggle('hidden', !e.target.checked);
    updateSummaryPreview();
  });

  $('#nestedMode').addEventListener('change', e => {
    state.nested.mode = e.target.value;
    updateSummaryPreview();
  });

  $('#nestedLeftArray').addEventListener('change', e => {
    state.nested.leftArrayPath = e.target.value;
    updateSummaryPreview();
  });

  $('#nestedRightArray').addEventListener('change', e => {
    state.nested.rightArrayPath = e.target.value;
    updateSummaryPreview();
  });

  $('#nestedOutputMode').addEventListener('change', e => {
    state.nested.outputMode = e.target.value;
    updateSummaryPreview();
  });

  $('#nestedOutputName').addEventListener('input', e => {
    state.nested.outputArrayName = e.target.value || 'items';
    updateSummaryPreview();
  });

  $('#btnAddNestedMapping').addEventListener('click', () => {
    state.nested.mappings.push({ leftField: '', rightField: '', leftTransform: null, rightTransform: null });
    renderNestedFieldMappings();
  });
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initNavigation();
});
