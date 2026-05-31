/**
 * ArrayProvider
 *
 * Провайдер для локального массива данных.
 * Реализует тот же интерфейс что и RestProvider —
 * используется для демо-режима без сервера.
 */
class ArrayProvider {

  constructor({ data, dimensions, measures, funcs, fields = {},
                cachedDimensions = [], maxCachedRows = 500_000,
                drillthroughQuery = null }) {
    this.data              = data;
    this.dimensions        = dimensions;
    this.measures          = measures;
    this.funcs             = funcs;
    this.fields            = fields;
    this.maxCachedRows     = maxCachedRows;
    this.drillthroughQuery = drillthroughQuery;

    this._cachedDims = [...cachedDimensions];
    this._store      = null;
    this._cacheRows  = 0;
  }

  // ── Cache API ──────────────────────────────────────────────────────────────

  async prefetch() {
    this._store     = null;
    this._cacheRows = 0;
    if (!this._cachedDims.length) return;

    const aggRows   = this._groupBy(this._cachedDims);
    this._store     = this._makeStore(this._cachedDims, aggRows);
    this._cacheRows = aggRows.length;
  }

  async countRows(logicalFields) {
    if (!logicalFields.length) return 0;
    const keys = new Set();
    for (const row of this.data) {
      keys.add(logicalFields.map(f => this._val(row, f)).join('|'));
    }
    return keys.size;
  }

  async refreshCache(newDims) {
    this._cachedDims = [...newDims];
    await this.prefetch();
  }

  get cachedDimensions() { return [...this._cachedDims]; }
  get cacheRows()        { return this._cacheRows; }

  // ── Данные для грида ───────────────────────────────────────────────────────

  getBestRows(requiredDims = [], activeFilters = {}) {
    if (!this._store) return null;

    const hasAllRequired = requiredDims.every(dim => {
      const col = (this.fields[dim] || {}).label || dim;
      return this._store.dimensions.includes(col);
    });
    if (!hasAllRequired) return null;

    const filterDims = Object.keys(activeFilters);
    const hasAllFilterDims = filterDims.every(dim => {
      const col = (this.fields[dim] || {}).label || dim;
      return this._store.dimensions.includes(col);
    });
    if (!hasAllFilterDims) return null;

    const rows = this._store.rows();
    return filterDims.length > 0
      ? this._filterRows(rows, activeFilters)
      : rows;
  }

  async getRowsForDims(requiredDims, activeFilters = {}) {
    const cached = this.getBestRows(requiredDims, activeFilters);
    if (cached) return { rows: cached, fromCache: true };

    const rows = this._groupBy(requiredDims, activeFilters);
    return { rows, fromCache: false };
  }

  // ── Drillthrough ───────────────────────────────────────────────────────────

  async countDistinct(logicalField) {
    const col  = (this.fields[logicalField] || {}).label || logicalField;
    const vals = new Set(this.data.map(r => String(r[col] ?? '')));
    return vals.size;
  }

  async getDistinctValues(logicalField) {
    const def     = this.fields[logicalField] || {};
    const col     = def.label   || logicalField;
    const sortCol = def.sortKey || col;
    const vals    = [...new Set(this.data.map(r => String(r[col] ?? '')))];
    return vals.sort((a, b) => {
      const av = this.data.find(r => String(r[col]) === a)?.[sortCol];
      const bv = this.data.find(r => String(r[col]) === b)?.[sortCol];
      if (av !== undefined && bv !== undefined && !isNaN(Number(av)) && !isNaN(Number(bv))) {
        return Number(av) - Number(bv);
      }
      return String(av ?? a).localeCompare(String(bv ?? b), 'ru');
    });
  }

  async drillthrough({ filters = {}, limit = 200 }) {
    let rows = this.data;

    // Применяем фильтры
    for (const [dim, val] of Object.entries(filters)) {
      const col = (this.fields[dim] || {}).label || dim;
      rows = rows.filter(r => String(r[col] ?? '') === String(val));
    }

    return rows.slice(0, limit);
  }

  // ── Агрегация ─────────────────────────────────────────────────────────────

  _groupBy(logicalFields, activeFilters = {}) {
    // Фильтруем исходные данные
    let data = this.data;
    if (Object.keys(activeFilters).length) {
      data = this._filterRawRows(data, activeFilters);
    }

    const cols   = logicalFields.map(f => (this.fields[f] || {}).label || f);
    const groups = new Map();

    for (const row of data) {
      const key = cols.map(c => String(row[c] ?? '')).join('|§|');
      if (!groups.has(key)) {
        const entry = {};
        for (const col of cols) entry[col] = row[col];
        // Добавляем sortKey если есть
        for (const f of logicalFields) {
          const def = this.fields[f] || {};
          if (def.sortKey) entry[def.sortKey] = row[def.sortKey];
        }
        // Инициализируем агрегаты
        for (const m of this.measures) {
          for (const fn of this.funcs) {
            entry[`${m}_${fn}`]    = fn === 'min' ? Infinity : fn === 'max' ? -Infinity : 0;
          }
          entry[`__count_${m}`] = 0;
          entry[`__sum2_${m}`]  = 0;
        }
        groups.set(key, entry);
      }
      const entry = groups.get(key);
      for (const m of this.measures) {
        const v = Number(row[m]) || 0;
        entry[`__count_${m}`]++;
        entry[`${m}_sum`]  = (entry[`${m}_sum`]  || 0) + v;
        entry[`${m}_count`]= entry[`__count_${m}`];
        entry[`${m}_min`]  = Math.min(entry[`${m}_min`] ?? Infinity, v);
        entry[`${m}_max`]  = Math.max(entry[`${m}_max`] ?? -Infinity, v);
        entry[`__sum2_${m}`] += v * v;
      }
    }

    // Вычисляем avg, stddev, variance
    for (const entry of groups.values()) {
      for (const m of this.measures) {
        const n   = entry[`__count_${m}`] || 1;
        const sum = entry[`${m}_sum`] || 0;
        const sum2= entry[`__sum2_${m}`] || 0;
        entry[`${m}_avg`]      = sum / n;
        const variance          = sum2 / n - (sum / n) ** 2;
        entry[`${m}_variance`] = variance;
        entry[`${m}_stddev`]   = Math.sqrt(Math.max(0, variance));
        delete entry[`__count_${m}`];
        delete entry[`__sum2_${m}`];
      }
    }

    return [...groups.values()];
  }

  _filterRawRows(data, activeFilters) {
    const predicates = [];
    for (const [dim, filter] of Object.entries(activeFilters)) {
      const col = (this.fields[dim] || {}).label || dim;
      if (filter.values && filter.values.length > 0) {
        const valSet = new Set(filter.values);
        predicates.push(row => valSet.has(String(row[col] ?? '')));
      }
      if (filter.searchText) {
        const text = filter.searchText.toLowerCase();
        predicates.push(filter.searchType === 'starts_with'
          ? row => String(row[col] ?? '').toLowerCase().startsWith(text)
          : row => String(row[col] ?? '').toLowerCase().includes(text)
        );
      }
    }
    if (!predicates.length) return data;
    return data.filter(row => predicates.every(p => p(row)));
  }

  _filterRows(rows, activeFilters) {
    const predicates = [];
    for (const [dim, filter] of Object.entries(activeFilters)) {
      const col = (this.fields[dim] || {}).label || dim;
      if (filter.values && filter.values.length > 0) {
        const valSet = new Set(filter.values);
        predicates.push(row => valSet.has(String(row[col] ?? '')));
      }
      if (filter.searchText) {
        const text = filter.searchText.toLowerCase();
        predicates.push(filter.searchType === 'starts_with'
          ? row => String(row[col] ?? '').toLowerCase().startsWith(text)
          : row => String(row[col] ?? '').toLowerCase().includes(text)
        );
      }
    }
    if (!predicates.length) return rows;
    const filtered = [];
    for (const row of rows) {
      if (predicates.every(p => p(row))) filtered.push(row);
    }
    return filtered;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _val(row, logicalField) {
    const col = (this.fields[logicalField] || {}).label || logicalField;
    return String(row[col] ?? '');
  }

  _makeStore(logicalFields, rows) {
    const dims  = logicalFields.map(f => (this.fields[f] || {}).label || f);
    // Добавляем sortKey колонки
    for (const f of logicalFields) {
      const def = this.fields[f] || {};
      if (def.sortKey && !dims.includes(def.sortKey)) dims.push(def.sortKey);
    }
    const store = new ColumnStore({
      dimensions: dims,
      measures:   this.measures,
      funcs:      this.funcs,
      capacity:   this.maxCachedRows,
    });
    store.append(rows);
    return store;
  }

  async load() {
    throw new Error('Use prefetch() / getRowsForDims() / drillthrough()');
  }
}
