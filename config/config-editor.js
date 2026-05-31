/**
 * config-editor.js
 */

// ── i18n ──────────────────────────────────────────────────────────────────────

const _lang = document.body.dataset.lang || 'ru';
const t = (key, vars) => {
  let str = I18N[_lang]?.[key] ?? I18N.ru[key] ?? key;
  if (vars) Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v); });
  return str;
};

// Применить переводы к статичному HTML
document.querySelectorAll('[data-i18n]').forEach(el => {
  el.textContent = t(el.dataset.i18n);
});
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
  el.placeholder = t(el.dataset.i18nPlaceholder);
});

// ── Состояние ─────────────────────────────────────────────────────────────────

let _columns = [];  // { name, title, type, sortKey, checked }
const _zones = { free: [], rows: [], columns: [], cache: [] };

// ── DOM refs ──────────────────────────────────────────────────────────────────

const mainQueryEl = document.getElementById('main-query');
const colsQueryEl = document.getElementById('cols-query');

// ── Синхронизация cols-query с main-query ─────────────────────────────────────

mainQueryEl.addEventListener('input', () => {
  const q = mainQueryEl.value.trim();
  colsQueryEl.value = q ? `SELECT * FROM (\n  ${q}\n) _t LIMIT 1` : '';
});

// ── Получить колонки ──────────────────────────────────────────────────────────

document.getElementById('btn-fetch-cols').addEventListener('click', async () => {
  const url = document.getElementById('server-url').value.trim();
  const query = colsQueryEl.value.trim();
  const status = document.getElementById('fetch-status');
  const btn = document.getElementById('btn-fetch-cols');

  if (!url || !query) { showStatus(status, 'error', t('ce_fillUrl')); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>' + t('loading');
  status.className = 'status';

  try {
    const res = await fetch(url + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!rows.length) throw new Error(t('ce_zeroRows'));

    // Сохраняем существующие настройки колонок
    _columns = Object.keys(rows[0]).map(name => {
      const existing = _columns.find(c => c.name === name);
      return existing || { name, title: '', type: guessType(name), sortKey: '', checked: false };
    });

    renderColsList();
    renderZones();
    updateMeasureSelect();
    showStatus(status, 'ok', t('ce_colsLoaded', { n: _columns.length }));
    generateConfig();

  } catch (err) {
    showStatus(status, 'error', t('ce_loadError') + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('ce_fetchBtn');
  }
});

// ── Угадать тип колонки ───────────────────────────────────────────────────────

function guessType(name) {
  return /revenue|amount|sales|units|qty|quantity|price|cost|profit|sum|total/i.test(name)
    ? 'measure' : 'dimension';
}

// ── Список колонок ────────────────────────────────────────────────────────────

function renderColsList() {
  const wrap = document.getElementById('cols-wrap');
  if (!_columns.length) {
    wrap.innerHTML = `<div class="fields-empty">${t('ce_emptyFields')}</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="cols-list">
      <div class="cols-list-header">
        <span></span>
        <span>${t('ce_colDb')}</span>
        <span>${t('ce_colTitle')}</span>
        <span>${t('type')}</span>
        <span>sortKey</span>
      </div>
      ${_columns.map((col, i) => `
        <div class="col-row ${col.checked ? 'is-checked' : ''}" data-i="${i}">
          <input type="checkbox" data-i="${i}" ${col.checked ? 'checked' : ''}>
          <span class="col-db-name" title="${col.name}">${col.name}</span>
          <input type="text" data-i="${i}" data-f="title"
            value="${escAttr(col.title)}" placeholder="${escAttr(col.name)}">
          <select data-i="${i}" data-f="type">
            <option value="dimension" ${col.type === 'dimension' ? 'selected' : ''}>${t('ce_dimension')}</option>
            <option value="measure"   ${col.type === 'measure' ? 'selected' : ''}>${t('ce_measure_type')}</option>
          </select>
          <select data-i="${i}" data-f="sortKey" ${col.type === 'measure' ? 'disabled' : ''}>
            <option value="">—</option>
            ${_columns.filter((_, j) => j !== i)
      .map(c => `<option value="${c.name}" ${col.sortKey === c.name ? 'selected' : ''}>${c.name}</option>`)
      .join('')}
          </select>
        </div>
      `).join('')}
    </div>
  `;

  // Чекбоксы
  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const col = _columns[+cb.dataset.i];
      col.checked = cb.checked;
      cb.closest('.col-row').classList.toggle('is-checked', cb.checked);
      if (cb.checked) {
        if (!inAnyZone(col.name) && col.type !== 'measure') _zones.free.push(col.name);
      } else {
        removeFromAllZones(col.name);
      }
      renderZones();
      updateMeasureSelect();
      generateConfig();
    });
  });

  // Title / тип / sortKey
  wrap.querySelectorAll('input[data-f], select[data-f]').forEach(el => {
    const update = () => {
      _columns[+el.dataset.i][el.dataset.f] = el.value;

      if (el.dataset.f === 'type') {
        if (el.value === 'measure') {
          _columns[+el.dataset.i].sortKey = '';
          removeFromAllZones(_columns[+el.dataset.i].name);
        } else {
          const col = _columns[+el.dataset.i];
          if (col.checked && !inAnyZone(col.name)) _zones.free.push(col.name);
        }
        updateMeasureSelect();
        const scrollTop = document.querySelector('.cols-list')?.scrollTop || 0;
        renderColsList();
        document.querySelector('.cols-list').scrollTop = scrollTop;
        renderZones();
      }

      if (el.dataset.f === 'title') renderZones();

      generateConfig();
    };
    el.addEventListener('change', update);
    if (el.tagName === 'INPUT') el.addEventListener('input', update);
  });
}

function inAnyZone(name) {
  return ['free', 'rows', 'columns', 'cache'].some(z => _zones[z].includes(name));
}

function removeFromAllZones(name) {
  for (const z of ['free', 'rows', 'columns', 'cache']) {
    _zones[z] = _zones[z].filter(n => n !== name);
  }
}

// ── Drag-зоны ─────────────────────────────────────────────────────────────────

function renderZones() {
  for (const zone of ['free', 'rows', 'columns', 'cache']) {
    const el = document.getElementById('dz-' + zone);
    el.innerHTML = '';
    for (const name of _zones[zone]) el.appendChild(makeChip(name, zone));
  }
}

function makeChip(name, zone) {
  const col = _columns.find(c => c.name === name);
  const chip = document.createElement('div');
  chip.className = 'dz-chip';
  chip.dataset.name = name;
  chip.dataset.zone = zone;

  const lbl = document.createElement('span');
  lbl.textContent = col?.title || name;
  chip.appendChild(lbl);

  if (zone !== 'free') {
    const rm = document.createElement('span');
    rm.className = 'dz-chip-remove';
    rm.textContent = '×';
    rm.addEventListener('mousedown', e => e.stopPropagation());
    rm.addEventListener('click', () => {
      _zones[zone] = _zones[zone].filter(n => n !== name);
      if (zone !== 'cache' && !_zones.rows.includes(name) &&
        !_zones.columns.includes(name) && !_zones.free.includes(name)) {
        _zones.free.push(name);
      }
      renderZones();
      generateConfig();
    });
    chip.appendChild(rm);
  }

  initChipDrag(chip);
  return chip;
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

let _placeholder = null;

function initChipDrag(chip) {
  chip.addEventListener('mousedown', e => {
    if (e.target.classList.contains('dz-chip-remove')) return;
    e.preventDefault();

    const name = chip.dataset.name;
    const fromZone = chip.dataset.zone;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost = null;

    const onMove = mv => {
      if (!dragging && Math.hypot(mv.clientX - startX, mv.clientY - startY) > 5) {
        dragging = true;
        chip.classList.add('dz-chip--dragging');
        ghost = chip.cloneNode(true);
        ghost.className = 'dz-chip dz-chip--ghost';
        Object.assign(ghost.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '9999',
          left: mv.clientX + 12 + 'px', top: mv.clientY - 12 + 'px',
        });
        document.body.appendChild(ghost);
      }
      if (!dragging) return;
      ghost.style.left = mv.clientX + 12 + 'px';
      ghost.style.top = mv.clientY - 12 + 'px';
      ghost.style.visibility = chip.style.visibility = 'hidden';
      updatePlaceholder(mv);
      ghost.style.visibility = chip.style.visibility = '';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost?.remove();
      chip.classList.remove('dz-chip--dragging');
      chip.style.visibility = '';

      if (!dragging) { clearHighlight(); return; }

      const ph = _placeholder;
      if (!ph?.parentNode) { clearHighlight(); return; }

      const zoneEl = ph.parentNode.closest('[data-dz-zone]') || ph.parentNode;
      const toZone = zoneEl.dataset.dzZone;
      const siblings = [...ph.parentNode.children];
      const afterChips = siblings.slice(siblings.indexOf(ph) + 1)
        .filter(el => el.classList.contains('dz-chip'));
      const beforeName = afterChips[0]?.dataset.name || null;

      clearHighlight();
      if (toZone) applyDrop(name, fromZone, toZone, beforeName);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function applyDrop(name, fromZone, toZone, beforeName) {
  if (toZone === 'cache') {
    if (!_zones.cache.includes(name)) _zones.cache.push(name);
    renderZones(); generateConfig(); return;
  }
  if (fromZone === 'cache') {
    _zones.cache = _zones.cache.filter(n => n !== name);
    renderZones(); generateConfig(); return;
  }

  _zones[fromZone] = _zones[fromZone].filter(n => n !== name);
  const arr = _zones[toZone];
  if (beforeName) {
    const idx = arr.indexOf(beforeName);
    arr.splice(idx !== -1 ? idx : arr.length, 0, name);
  } else {
    arr.push(name);
  }
  renderZones();
  generateConfig();
}

function updatePlaceholder(e) {
  clearHighlight();
  const zoneEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dz-zone]');
  if (zoneEl) zoneEl.classList.add('dz-over');

  const ph = document.createElement('div');
  ph.className = 'dz-placeholder';
  _placeholder = ph;

  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dz-chip');
  if (target && !target.classList.contains('dz-placeholder')) {
    const rect = target.getBoundingClientRect();
    target.parentNode.insertBefore(ph, e.clientX < rect.left + rect.width / 2 ? target : target.nextSibling);
  } else if (zoneEl) {
    (zoneEl.querySelector('[id^="dz-"]') || zoneEl).appendChild(ph);
  }
}

function clearHighlight() {
  document.querySelectorAll('[data-dz-zone]').forEach(z => z.classList.remove('dz-over'));
  _placeholder?.remove();
  _placeholder = null;
}

// ── Селекты ───────────────────────────────────────────────────────────────────

function updateMeasureSelect() {
  const sel = document.getElementById('init-measure');
  const current = sel.value;
  const measures = _columns.filter(c => c.checked && c.type === 'measure');
  sel.innerHTML = measures.map(c =>
    `<option value="${c.name}" ${c.name === current ? 'selected' : ''}>${c.title || c.name}</option>`
  ).join('');
}

function updateFuncSelect() {
  const sel = document.getElementById('init-func');
  const current = sel.value;
  const funcs = [...document.querySelectorAll('#funcs-wrap input:checked')].map(cb => cb.value);
  sel.innerHTML = funcs.map(f =>
    `<option value="${f}" ${f === current ? 'selected' : ''}>${f}</option>`
  ).join('');
}

// ── Drillthrough переключение ─────────────────────────────────────────────────

document.querySelectorAll('input[name="dt-type"]').forEach(r => {
  r.addEventListener('change', () => {
    document.getElementById('dt-sql-wrap').style.display = r.value === 'sql' ? '' : 'none';
    document.getElementById('dt-url-wrap').style.display = r.value === 'url' ? '' : 'none';
    generateConfig();
  });
});

document.getElementById('dt-query').addEventListener('input', generateConfig);
document.getElementById('dt-url').addEventListener('input', generateConfig);

// ── Генерация конфига ─────────────────────────────────────────────────────────

['init-measure', 'init-func', 'init-max-rows', 'init-filter-limit'].forEach(id => {
  document.getElementById(id).addEventListener('change', generateConfig);
  document.getElementById(id).addEventListener('input', generateConfig);
});

document.querySelectorAll('#funcs-wrap input').forEach(cb => {
  cb.addEventListener('change', () => { updateFuncSelect(); generateConfig(); });
});

function generateConfig() {
  const active = _columns.filter(c => c.checked);
  const dims = active.filter(c => c.type === 'dimension');
  const measures = active.filter(c => c.type === 'measure');
  const funcs = [...document.querySelectorAll('#funcs-wrap input:checked')].map(cb => cb.value);

  const mainQuery = mainQueryEl.value.trim();
  const maxRows = parseInt(document.getElementById('init-max-rows').value) || 500_000;
  const measure = document.getElementById('init-measure').value || (measures[0]?.name ?? '');
  const func = document.getElementById('init-func').value;
  const fltLimit = parseInt(document.getElementById('init-filter-limit').value) || 30;
  const dtType = document.querySelector('input[name="dt-type"]:checked').value;
  const dtQuery = document.getElementById('dt-query').value.trim();
  const dtUrl = document.getElementById('dt-url').value.trim();

  const fieldsLines = active.map(c => {
    const parts = [`label: '${escStr(c.name)}'`];
    if (c.title) parts.push(`title: '${escStr(c.title)}'`);
    if (c.sortKey) parts.push(`sortKey: '${escStr(c.sortKey)}'`);
    return `    ${c.name}: { ${parts.join(', ')} },`;
  }).join('\n');

  const list = arr => arr.map(n => `'${n}'`).join(', ');
  const cacheFiltered = _zones.cache.filter(n => dims.find(d => d.name === n));
  const maxRowsStr = maxRows.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_');
  const drillthroughStr = dtType === 'sql'
    ? `drillthroughQuery: \`\n    ${dtQuery}\n  \`,`
    : `drillthroughUrl: '${dtUrl}',`;

  const config = `const CONFIG = {
  query: \`
    ${mainQuery}
  \`,

  dimensions: [${list(dims.map(c => c.name))}],
  measures:   [${list(measures.map(c => c.name))}],
  funcs:      [${funcs.map(f => `'${f}'`).join(', ')}],

  fields: {
${fieldsLines}
  },

  cachedDimensions: [${list(cacheFiltered)}],

  rows:    [${list(_zones.rows)}],
  columns: [${list(_zones.columns)}],
  measure: '${measure}',
  func:    '${func}',

  maxCachedRows:       ${maxRowsStr},
  filterCheckboxLimit: ${fltLimit},
  ${drillthroughStr}
};`;

  document.getElementById('config-preview').value = config;
  localStorage.setItem('pivot_config_preview', config);
}

// ── Предпросмотр ──────────────────────────────────────────────────────────────

document.getElementById('btn-preview').addEventListener('click', () => {
  const text = document.getElementById('config-preview').value;
  if (!text.trim()) return;
  localStorage.setItem('pivot_config_preview', text);
  window.open('../demo/index.html?preview=1', '_blank');
});

// ── Конфиги на сервере ────────────────────────────────────────────────────────

const serverUrl = () => document.getElementById('server-url').value.trim();

async function loadConfigList() {
  try {
    const res = await fetch(serverUrl() + '/configs');
    const names = await res.json();
    const sel = document.getElementById('sel-config-name');
    const current = sel.value;
    sel.innerHTML = `<option value="">${t('ce_selectConfig')}</option>` +
      names.map(n => `<option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>`).join('');
  } catch (e) {
    console.warn('Не удалось загрузить список конфигов:', e.message);
  }
}

// Загрузить конфиг с сервера
document.getElementById('sel-config-name').addEventListener('change', async (e) => {
  const name = e.target.value;
  if (!name) return;
  document.getElementById('inp-config-name').value = name;
  try {
    const res = await fetch(serverUrl() + '/configs/' + name);
    const cfg = await res.json();
    _columns = [];
    applyConfig(cfg);
    document.getElementById('btn-fetch-cols').click();
  } catch (err) {
    alert(t('ce_loadFailed') + err.message);
  }
});

// Сохранить конфиг на сервер
document.getElementById('btn-save-config').addEventListener('click', async () => {
  const name = document.getElementById('inp-config-name').value.trim();
  if (!name) { alert(t('ce_enterName')); return; }

  const text = document.getElementById('config-preview').value;
  if (!text.trim()) { alert(t('ce_emptyConfig')); return; }

  try {
    const fn = new Function(text + '\nreturn CONFIG;');
    const cfg = fn();
    const res = await fetch(serverUrl() + '/configs/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadConfigList();
    document.getElementById('sel-config-name').value = name;
    alert(t('ce_configSaved', { name }));
  } catch (err) {
    alert(t('ce_saveFailed') + err.message);
  }
});

// ── Применить конфиг ──────────────────────────────────────────────────────────

function applyConfig(cfg) {
  mainQueryEl.value = (cfg.query || '').trim();
  mainQueryEl.dispatchEvent(new Event('input'));

  const funcsSet = new Set(cfg.funcs || []);
  document.querySelectorAll('#funcs-wrap input').forEach(cb => {
    cb.checked = funcsSet.has(cb.value);
  });
  updateFuncSelect();

  document.getElementById('init-max-rows').value = cfg.maxCachedRows || 500000;
  document.getElementById('init-filter-limit').value = cfg.filterCheckboxLimit || 30;
  document.getElementById('init-func').value = cfg.func || 'sum';

  if (cfg.drillthroughUrl) {
    document.querySelector('input[name="dt-type"][value="url"]').checked = true;
    document.getElementById('dt-sql-wrap').style.display = 'none';
    document.getElementById('dt-url-wrap').style.display = '';
    document.getElementById('dt-url').value = cfg.drillthroughUrl;
  } else {
    document.querySelector('input[name="dt-type"][value="sql"]').checked = true;
    document.getElementById('dt-sql-wrap').style.display = '';
    document.getElementById('dt-url-wrap').style.display = 'none';
    document.getElementById('dt-query').value = (cfg.drillthroughQuery || '').trim();
  }

  if (cfg.fields) {
    _columns = Object.entries(cfg.fields).map(([name, def]) => ({
      name,
      title: def.title || '',
      type: (cfg.measures || []).includes(name) ? 'measure' : 'dimension',
      sortKey: def.sortKey || '',
      checked: true,
    }));

    _zones.rows = [...(cfg.rows || [])];
    _zones.columns = [...(cfg.columns || [])];
    _zones.cache = [...(cfg.cachedDimensions || [])];
    _zones.free = _columns
      .filter(c => c.checked && c.type === 'dimension')
      .map(c => c.name)
      .filter(n => !_zones.rows.includes(n) && !_zones.columns.includes(n));

    renderColsList();
    renderZones();
    updateMeasureSelect();
    document.getElementById('init-measure').value = cfg.measure || '';
  }

  generateConfig();
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function escAttr(str) { return (str || '').replace(/"/g, '&quot;'); }
function escStr(str) { return (str || '').replace(/'/g, "\\'"); }

function showStatus(el, type, msg) {
  el.className = 'status ' + type;
  el.textContent = msg;
  if (type === 'ok') setTimeout(() => { el.className = 'status'; }, 3000);
}

// ── Настройки БД ──────────────────────────────────────────────────────────────

document.getElementById('btn-load-db').addEventListener('click', async () => {
  const status = document.getElementById('db-status');
  try {
    const res = await fetch(serverUrl() + '/server-config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const sel = document.getElementById('db-connector');
    sel.innerHTML = Object.entries(data.connectors || {})
      .map(([k, name]) => `<option value="${k}" ${k === data.connector ? 'selected' : ''}>${name}</option>`)
      .join('');

    document.getElementById('db-host').value = data.host || '';
    document.getElementById('db-port').value = data.port || '';
    document.getElementById('db-name').value = data.dbname || '';
    document.getElementById('db-user').value = data.user || '';

    showStatus(status, 'ok', t('ce_dbLoaded'));
  } catch (err) {
    showStatus(status, 'error', t('ce_loadError') + err.message);
  }
});

document.getElementById('btn-save-db').addEventListener('click', async () => {
  const status = document.getElementById('db-status');
  const data = {
    connector: document.getElementById('db-connector').value,
    host: document.getElementById('db-host').value.trim(),
    port: document.getElementById('db-port').value.trim(),
    dbname: document.getElementById('db-name').value.trim(),
    user: document.getElementById('db-user').value.trim(),
    password: document.getElementById('db-password').value,
  };

  if (!data.host || !data.dbname || !data.user) {
    showStatus(status, 'error', t('ce_fillDbFields'));
    return;
  }

  try {
    const res = await fetch(serverUrl() + '/server-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    document.getElementById('db-password').value = '';
    showStatus(status, 'ok', t('ce_dbSaved'));
  } catch (err) {
    showStatus(status, 'error', t('ce_loadError') + err.message);
  }
});

document.getElementById('btn-test-db').addEventListener('click', async () => {
  const status = document.getElementById('db-status');
  const data = {
    host: document.getElementById('db-host').value.trim(),
    port: document.getElementById('db-port').value.trim(),
    dbname: document.getElementById('db-name').value.trim(),
    user: document.getElementById('db-user').value.trim(),
    password: document.getElementById('db-password').value,
  };
  try {
    const res = await fetch(serverUrl() + '/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    showStatus(status, 'ok', t('ce_testOk'));
  } catch (err) {
    showStatus(status, 'error', t('ce_testError') + err.message);
  }
});

// ── Инициализация ─────────────────────────────────────────────────────────────

updateFuncSelect();
generateConfig();
loadConfigList();
document.getElementById('btn-load-db').click();
