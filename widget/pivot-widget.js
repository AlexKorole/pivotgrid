/**
 * pivot-widget.js
 */

// ── Утилиты ───────────────────────────────────────────────────────────────────

const fmt = (v) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v);

// ── Контейнер и настройки ────────────────────────────────────────────────────

const pivotEl     = document.getElementById('pivot-container')
                 || document.querySelector('[data-config]')
                 || document.querySelector('[data-demo]');

const IS_DEMO     = pivotEl.dataset.demo    === 'true';
const SERVER_URL  = pivotEl.dataset.server  || 'http://localhost:8000';
const CONFIG_NAME = pivotEl.dataset.config;
const IS_PREVIEW  = new URLSearchParams(location.search).has('preview');
const LANG        = pivotEl.dataset.lang    || 'ru';
const t           = (key, vars = {}) => {
  let str = (I18N[LANG] || I18N.ru)[key] || key;
  for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
};

// ── HTML структура ────────────────────────────────────────────────────────────

function buildHTML() {
  return `
    <div class="demo-toggles">
      <label><input type="checkbox" id="chk-cache"  checked> ${t('cache')}</label>
      <label><input type="checkbox" id="chk-fields" checked> ${t('constructor')}</label>
    </div>

    <div class="cache-zone">
      <div class="cache-zone-header">
        <span class="cache-zone-label">${t('cache')}</span>
        <div class="cache-meter-wrap">
          <div class="cache-meter-bar">
            <div class="cache-meter-fill ok" id="cache-meter-fill" style="width:0%"></div>
          </div>
          <span class="cache-meter-label" id="cache-meter-label">—</span>
        </div>
        <span class="cache-status empty" id="cache-status">${t('cacheEmpty')}</span>
        <button class="toolbar-btn" id="btn-refresh-cache" disabled>${t('cacheRefresh')}</button>
      </div>
      <div class="cache-zone-body" id="cache-chips"></div>
    </div>

    <div class="cache-toast" id="cache-toast"></div>

    <div class="field-zones">
      <div class="fz-zone fz-zone--filters">
        <div class="fz-zone-label">${t('filters')}</div>
        <div class="fz-zone-body" id="fz-chips-filters" data-fz-zone="filters"></div>
      </div>
      <div class="fz-zone fz-zone--free">
        <div class="fz-zone-label">${t('fields')}</div>
        <div class="fz-zone-body" id="fz-chips-free" data-fz-zone="free"></div>
      </div>
      <div class="fz-zone fz-zone--rows">
        <div class="fz-zone-label">${t('rows')}</div>
        <div class="fz-zone-body" id="fz-chips-rows" data-fz-zone="rows"></div>
      </div>
      <div class="fz-zone fz-zone--columns">
        <div class="fz-zone-label">${t('columns')}</div>
        <div class="fz-zone-body" id="fz-chips-columns" data-fz-zone="columns"></div>
      </div>
    </div>

    <div class="toolbar">
      <span class="toolbar-label">${t('measure')}</span>
      <select id="sel-measure"></select>
      <div class="toolbar-sep"></div>
      <span class="toolbar-label">${t('func')}</span>
      <select id="sel-func"></select>
      <div class="toolbar-sep"></div>
      <button class="toolbar-btn" id="btn-expand">${t('expandRows')}</button>
      <button class="toolbar-btn" id="btn-collapse">${t('collapseRows')}</button>
      <div class="toolbar-sep"></div>
      <button class="toolbar-btn" id="btn-expand-cols">${t('expandCols')}</button>
      <button class="toolbar-btn" id="btn-collapse-cols">${t('collapseCols')}</button>
      <div class="toolbar-sep"></div>
      <button class="toolbar-btn toolbar-btn--toggle" id="btn-subtotals">${t('subtotals')}</button>
      <button class="toolbar-btn" id="btn-export">${t('exportCsv')}</button>
    </div>

    <div id="loading" style="
      display: flex; align-items: center; justify-content: center;
      height: 200px; font-size: 13px; color: #999;
    ">${t('loading')}</div>

    <div id="error" style="
      display: none; padding: 16px; background: #fff3f3;
      border: 1px solid #fcc; border-radius: 8px;
      font-size: 13px; color: #c00; margin-bottom: 12px;
    "></div>

    <div id="pivot-grid" class="pg-root" style="opacity:0; flex:1; min-height:200px; overflow:hidden;"></div>

    <div class="dt-panel" id="dt-panel">
      <div class="dt-header">
        <span class="dt-header-label">${t('drillthrough')}</span>
        <span class="dt-header-context" id="dt-context"></span>
        <span class="dt-header-value" id="dt-value"></span>
        <button class="dt-header-close" id="dt-close">×</button>
      </div>
      <div class="dt-filters" id="dt-filters"></div>
      <div class="dt-body">
        <table class="dt-table">
          <thead><tr id="dt-thead"></tr></thead>
          <tbody id="dt-tbody"></tbody>
        </table>
      </div>
      <div class="dt-footer" id="dt-footer"></div>
    </div>
  `;
}

const isEmpty = !pivotEl.dataset.standalone;
if (isEmpty) {
  pivotEl.style.cssText = `
    display: flex; flex-direction: column;
    height: 100dvh; overflow: hidden;
    padding: 12px 12px 0 12px; gap: 8px;
    font-family: -apple-system, 'Segoe UI', sans-serif;
    background: #f4f5f7; color: #1a1a1a; box-sizing: border-box;
  `;
  pivotEl.innerHTML = buildHTML();
}

const gridEl = isEmpty
  ? document.getElementById('pivot-grid')
  : pivotEl;

// ── Утилиты UI ────────────────────────────────────────────────────────────────

function setLoading(on) {
  document.getElementById('loading').style.display = on ? 'flex' : 'none';
  gridEl.style.opacity = on ? '0' : '1';
}

function setGridLoading(on) {
  let overlay = document.getElementById('grid-loading-overlay');
  if (on) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'grid-loading-overlay';
      overlay.style.cssText = `
        position: absolute; inset: 0;
        background: rgba(255,255,255,0.7);
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; color: #999; z-index: 100;
      `;
      overlay.textContent = t('loadingGrid');
      gridEl.appendChild(overlay);
    }
  } else {
    overlay?.remove();
  }
}

function setError(err) {
  setLoading(false);
  const el = document.getElementById('error');
  el.style.display = 'block';
  el.textContent   = t('errorPrefix') + (err.message || err);
}

// ── Конфиг ────────────────────────────────────────────────────────────────────

let CONFIG = {};

async function loadConfig() {
  if (IS_DEMO) {
    CONFIG = DEMO_CONFIG;
    return;
  }

  if (IS_PREVIEW) {
    const text = localStorage.getItem('pivot_config_preview');
    if (text) {
      const fn = new Function(text + '\nreturn CONFIG;');
      CONFIG   = fn();
    }
    return;
  }

  if (CONFIG_NAME) {
    const res = await fetch(`${SERVER_URL}/configs/${CONFIG_NAME}`);
    if (!res.ok) throw new Error(`Config "${CONFIG_NAME}" not found`);
    CONFIG = await res.json();
    return;
  }

  throw new Error('Не указан data-config на контейнере грида');
}

// ── Состояние ─────────────────────────────────────────────────────────────────

let provider;
let aggregator;
let grid;
let currentRows    = [];
let currentColumns = [];
let currentMeasure = '';
let currentFunc    = '';
let currentFilters = {};
let _rebuilding    = false;

// ── Построение грида ──────────────────────────────────────────────────────────

async function rebuildGrid() {
  if (_rebuilding) return;
  _rebuilding = true;

  try {
    const required = [...new Set([...currentRows, ...currentColumns])];
    let aggRows    = provider.getBestRows(required, currentFilters);

    if (!aggRows) {
      setGridLoading(true);
      const result = await provider.getRowsForDims(required, currentFilters);
      setGridLoading(false);
      aggRows = result.rows;
    }

    if (!aggRows) return;

    const result = aggregator.build({
      rows:      currentRows,
      columns:   currentColumns,
      measure:   currentMeasure,
      func:      currentFunc,
      aggRows,
      fieldDefs: CONFIG.fields,
    });

    if (!grid) {
      grid = new PivotGrid({
        container: gridEl,
        result,
        rows:      currentRows,
        columns:   currentColumns,
        measure:   currentMeasure,
        fieldDefs: CONFIG.fields,
      });
      grid.collapseAll();
    } else {
      grid.setResult(result, {
        rows:      currentRows,
        columns:   currentColumns,
        measure:   currentMeasure,
        fieldDefs: CONFIG.fields,
      });
    }
  } finally {
    _rebuilding = false;
  }
}

function reconfig() { rebuildGrid().then(() => grid?.collapseAll()); }
function recalc()   { rebuildGrid(); }

// ── Toolbar ───────────────────────────────────────────────────────────────────

function initToolbar() {
  const selMeasure = document.getElementById('sel-measure');
  for (const m of CONFIG.measures) {
    const def = CONFIG.fields[m] || {};
    const opt = document.createElement('option');
    opt.value       = m;
    opt.textContent = def.title || def.label || m;
    selMeasure.appendChild(opt);
  }

  const selFunc = document.getElementById('sel-func');
  for (const f of CONFIG.funcs) {
    const opt = document.createElement('option');
    opt.value       = f;
    opt.textContent = f;
    opt.selected    = f === CONFIG.func;
    selFunc.appendChild(opt);
  }

  selMeasure.addEventListener('change', (e) => { currentMeasure = e.target.value; recalc(); });
  selFunc.addEventListener('change',    (e) => { currentFunc    = e.target.value; recalc(); });

  document.getElementById('btn-expand').addEventListener('click',       () => grid?.expandAll());
  document.getElementById('btn-collapse').addEventListener('click',      () => grid?.collapseAll());
  document.getElementById('btn-expand-cols').addEventListener('click',   () => grid?.expandAllCols());
  document.getElementById('btn-collapse-cols').addEventListener('click', () => grid?.collapseAllCols());

  let _subtotalsVisible = true;
  document.getElementById('btn-subtotals').addEventListener('click', () => {
    _subtotalsVisible = !_subtotalsVisible;
    grid?.toggleSubtotals(_subtotalsVisible);
    document.getElementById('btn-subtotals').classList.toggle('is-active', !_subtotalsVisible);
  });

  document.getElementById('chk-cache').addEventListener('change', (e) => {
    document.querySelector('.cache-zone').style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('chk-fields').addEventListener('change', (e) => {
    document.querySelector('.field-zones').style.display = e.target.checked ? '' : 'none';
  });
}

// ── Экспорт CSV ───────────────────────────────────────────────────────────────

function initExport() {
  document.getElementById('btn-export').addEventListener('click', async () => {
    const required = [...new Set([...currentRows, ...currentColumns])];
    const { rows } = await provider.getRowsForDims(required, currentFilters);

    const escape  = (v) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };
    const title    = (dim) => { const d = CONFIG.fields[dim] || {}; return d.title || d.label || dim; };
    const dimCols  = required.map(f => (CONFIG.fields[f] || {}).label || f);
    const measCols = CONFIG.measures.map(m => `${m}_${currentFunc}`);
    const header   = [...required.map(title), ...CONFIG.measures.map(title)].map(escape).join(',');
    const lines    = [header];

    for (const row of rows) {
      lines.push([
        ...dimCols.map(col => escape(row[col])),
        ...measCols.map(col => escape(row[col] ?? '')),
      ].join(','));
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `pivot_${currentMeasure}_${currentFunc}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ── Drillthrough ──────────────────────────────────────────────────────────────

function initDrillthrough() {
  const dtPanel   = document.getElementById('dt-panel');
  const dtContext = document.getElementById('dt-context');
  const dtValue   = document.getElementById('dt-value');
  const dtFilters = document.getElementById('dt-filters');
  const dtTbody   = document.getElementById('dt-tbody');
  const dtFooter  = document.getElementById('dt-footer');

  document.addEventListener('drillthrough', async (e) => {
    if (!CONFIG.drillthroughQuery && !CONFIG.drillthroughUrl) return;

    const { context, value } = e.detail;

    if (CONFIG.drillthroughUrl) {
      window.open(`${CONFIG.drillthroughUrl}?${new URLSearchParams(context)}`, '_blank');
      return;
    }

    const keys = Object.keys(context);
    dtContext.textContent = keys.length ? keys.map(k => context[k]).join(' › ') : t('allData');
    dtValue.textContent   = fmt(value);
    dtFilters.innerHTML   = keys.map(k => `
      <div class="dt-filter-tag"><span class="tag-key">${k}:</span> ${context[k]}</div>
    `).join('');

    dtTbody.innerHTML = `<tr><td colspan="7" style="padding:12px;color:#999">${t('loadingGrid')}</td></tr>`;
    dtPanel.classList.add('visible');
    gridEl.style.marginBottom = '300px';

    try {
      const rows = await provider.drillthrough({ filters: context });
      const cols = rows.length ? Object.keys(rows[0]) : [];

      document.getElementById('dt-thead').innerHTML = cols.map(c => {
        const isNum = rows.length && typeof rows[0][c] === 'number';
        return `<th class="${isNum ? 'num' : ''}">${c}</th>`;
      }).join('');

      dtTbody.innerHTML = rows.length
        ? rows.map(r =>
            '<tr>' + cols.map(c => {
              const v = r[c]; const isNum = typeof v === 'number';
              return `<td class="${isNum ? 'num' : ''}">${isNum ? fmt(v) : (v ?? '—')}</td>`;
            }).join('') + '</tr>'
          ).join('')
        : `<tr><td colspan="${cols.length || 1}" style="padding:12px;color:#999">${t('noData')}</td></tr>`;

      const totals = CONFIG.measures.map(m => {
        const total = rows.reduce((s, r) => s + Number(r[m] || 0), 0);
        const def   = CONFIG.fields[m] || {};
        return `<span>${def.title || m}: <strong>${fmt(total)}</strong></span>`;
      }).join('');

      dtFooter.innerHTML = `
        <span>${t('shown')}: <strong>${rows.length}</strong></span>
        ${totals}
        ${rows.length >= 200 ? `<span class="dt-warning">${t('firstN', { n: 200 })}</span>` : ''}
      `;
    } catch (err) {
      dtTbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:#c00">${err.message}</td></tr>`;
    }
  });

  document.getElementById('dt-close').addEventListener('click', () => {
    dtPanel.classList.remove('visible');
    gridEl.style.marginBottom = '';
  });
}

// ── Инициализация ─────────────────────────────────────────────────────────────

async function init() {
  try {
    setLoading(true);

    await loadConfig();

    currentRows    = CONFIG.rows    || [];
    currentColumns = CONFIG.columns || [];
    currentMeasure = CONFIG.measure || '';
    currentFunc    = CONFIG.func    || 'sum';

    provider = IS_DEMO
      ? new ArrayProvider({
          data:             DEMO_DATA,
          dimensions:       CONFIG.dimensions,
          measures:         CONFIG.measures,
          funcs:            CONFIG.funcs,
          fields:           CONFIG.fields,
          cachedDimensions: CONFIG.cachedDimensions,
          maxCachedRows:    CONFIG.maxCachedRows,
        })
      : new RestProvider({
          url:               `${SERVER_URL}/query`,
          query:             CONFIG.query,
          dimensions:        CONFIG.dimensions,
          measures:          CONFIG.measures,
          funcs:             CONFIG.funcs,
          fields:            CONFIG.fields,
          cachedDimensions:  CONFIG.cachedDimensions,
          maxCachedRows:     CONFIG.maxCachedRows,
          drillthroughQuery: CONFIG.drillthroughQuery,
        });

    aggregator = new Aggregator();

    const filterManager = new FilterManager({
      provider, fields: CONFIG.fields, config: CONFIG,
    });

    const fieldZones = new FieldZones({
      dimensions:     CONFIG.dimensions,
      fields:         CONFIG.fields,
      initialRows:    CONFIG.rows,
      initialColumns: CONFIG.columns,
      initialFilters: [],
      onChange({ rows, columns, filters }) {
        const prevFilters = Object.keys(filterManager._state);
        for (const dim of filters) {
          if (!prevFilters.includes(dim)) filterManager.onDimAdded(dim);
        }
        for (const dim of prevFilters) {
          if (!filters.includes(dim)) filterManager.onDimRemoved(dim);
        }
        currentRows    = rows;
        currentColumns = columns;
        reconfig();
      },
      onFilterOpen(dim, chipEl) { filterManager.openFor(dim, chipEl); },
    });

    filterManager.onChange = () => {
      fieldZones.setFilterHints(filterManager.getFilterHints());
      currentFilters = filterManager.getActiveFilters();
      rebuildGrid();
    };

    initToolbar();
    initExport();
    initDrillthrough();

    await provider.prefetch();
    await rebuildGrid();
    setLoading(false);

    new CacheManager({
      provider,
      dimensions:    CONFIG.dimensions,
      maxCachedRows: CONFIG.maxCachedRows,
      initialCount:  provider.cacheRows,
      onRefresh:     rebuildGrid,
      lang:          LANG,
    });

  } catch (err) {
    setError(err);
  }
}

init();
