/**
 * RestProvider
 *
 * Caching strategy:
 *   - On startup, one GROUP BY over cachedDimensions → cache (ColumnStore)
 *   - Everything else is lazy, not cached
 *   - countRows(dims) → COUNT query for UI validation before adding to cache
 *   - refreshCache(dims) → clear cache + new GROUP BY
 */
class RestProvider {

  constructor({ url, query, dimensions, measures, funcs, fields = {},
    cachedDimensions = [], maxCachedRows = 500_000, drillthroughQuery = null }) {
    this.url = url;
    this.query = query;
    this.dimensions = dimensions;
    this.measures = measures;
    this.funcs = funcs;
    this.fields = fields;
    this.maxCachedRows = maxCachedRows;

    this._cachedDims = [...cachedDimensions];
    this._store = null;  // single ColumnStore cache
    this._cacheRows = 0;     // rows in cache after last prefetch

    this.drillthroughQuery = drillthroughQuery;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initial load: one GROUP BY over cachedDimensions.
   * Does nothing if the list is empty.
   */
  async prefetch() {
    this._store = null;
    this._cacheRows = 0;

    if (!this._cachedDims.length) return;

    const rows = await this._fetchGroupBy(this._cachedDims);
    this._store = this._makeStore(this._cachedDims, rows);
    this._cacheRows = rows.length;
  }

  /**
   * COUNT of rows for a GROUP BY over the given set of dimensions.
   * Used by CacheManager to validate before adding a dimension to cache.
   * @param {string[]} logicalFields — logical field names (from CONFIG.dimensions)
   * @returns {Promise<number>}
   */
  async countRows(logicalFields) {
    if (!logicalFields.length) return 0;
    const cols = this._expandFields(logicalFields).join(', ');
    const sql = `
      SELECT COUNT(*) AS cnt
      FROM (
        SELECT ${cols}
        FROM   (${this.query}) _t
        GROUP  BY ${cols}
      ) _g
    `;
    const rows = await this._execute(sql);
    return Number(rows[0]?.cnt || 0);
  }

  /**
   * Clears the cache and reloads GROUP BY over the new set of dimensions.
   * Called by the "Refresh cache" button.
   */
  async refreshCache(newDims) {
    this._cachedDims = [...newDims];
    await this.prefetch();
  }

  /** Current list of cached dimensions. */
  get cachedDimensions() { return [...this._cachedDims]; }

  /** Number of rows in cache (updated after prefetch/refreshCache). */
  get cacheRows() { return this._cacheRows; }

  // ── Grid data ────────────────────────────────────────────────────────────────

  /**
   * Returns iterable rows from cache if the cache covers requiredDims.
   * Otherwise returns null.
   */
  getBestRows(requiredDims = [], activeFilters = {}) {
    if (!this._store) return null;

    const hasAllRequired = requiredDims.every(dim => {
      const col = (this.fields[dim] || {}).label || dim;
      return this._store.dimensions.includes(col);
    });
    if (!hasAllRequired) return null;

    // If any filter dimension is missing from store — fall back to lazy SQL with WHERE
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

    const rows = await this._fetchGroupBy(requiredDims, activeFilters);
    return { rows, fromCache: false };
  }

  /**
   * Filters rows from cache by active filters (no server request).
   */
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

    // Materialise into array — stable and predictable
    const filtered = [];
    for (const row of rows) {
      if (predicates.every(p => p(row))) filtered.push(row);
    }
    return filtered;
  }

  // ── Drillthrough ───────────────────────────────────────────────────────────

  async countDistinct(logicalField) {
    const col = (this.fields[logicalField] || {}).label || logicalField;
    const sql = `SELECT COUNT(DISTINCT ${col}) AS cnt FROM (${this.query}) _t`;
    const rows = await this._execute(sql);
    return Number(rows[0]?.cnt || 0);
  }

  async getDistinctValues(logicalField) {
    const def = this.fields[logicalField] || {};
    const col = def.label || logicalField;
    const sortCol = def.sortKey || col;
    const sql = sortCol !== col
      ? `SELECT DISTINCT ${col}, ${sortCol} FROM (${this.query}) _t ORDER BY ${sortCol}`
      : `SELECT DISTINCT ${col} FROM (${this.query}) _t ORDER BY ${sortCol}`;
    const rows = await this._execute(sql);
    return rows.map(r => String(r[col] ?? ''));
  }

  async drillthrough({ filters = {} }) {
    const { where, params } = this._buildWhere(filters);
    const sql = this.drillthroughQuery
      ? this.drillthroughQuery.replace('{filters}', where ? where.replace('WHERE ', '') : '1=1')
      : `SELECT * FROM (${this.query}) _t ${where} LIMIT 200`;
    return this._execute(sql, params);
  }

  // ── SQL helpers ────────────────────────────────────────────────────────────

  _fetchGroupBy(logicalFields, activeFilters = {}) {
    const select = [];
    const groupBy = [];
    const orderBy = [];

    for (const field of logicalFields) {
      const def = this.fields[field] || {};
      if (def.sortKey) {
        select.push(def.sortKey, def.label);
        groupBy.push(def.sortKey, def.label);
        orderBy.push(def.sortKey);
      } else {
        const col = def.label || field;
        select.push(col);
        groupBy.push(col);
        orderBy.push(col);
      }
    }

    const aggExprs = this.measures.flatMap(m =>
      this.funcs.map(fn => `${fn.toUpperCase()}(${m}) AS ${m}_${fn}`)
    ).join(', ');

    const { where, params } = this._buildFiltersWhere(activeFilters);

    const sql = `
      SELECT ${[...select, aggExprs].join(', ')}
      FROM   (${this.query}) _t
      ${where}
      GROUP  BY ${groupBy.join(', ')}
      ORDER  BY ${orderBy.join(', ')}
    `;

    return this._execute(sql, params);
  }

  /**
   * Builds a parameterized WHERE clause for active filters. Column names
   * still come straight from the trusted config (this.fields) — only the
   * filter *values* are bound as SQL parameters, never inlined as text.
   * @returns {{ where: string, params: object }}
   */
  _buildFiltersWhere(activeFilters = {}) {
    const conditions = [];
    const params = {};
    let i = 0;
    const bind = (val) => {
      const key = `p${i++}`;
      params[key] = val;
      return `%(${key})s`;
    };

    for (const [dim, filter] of Object.entries(activeFilters)) {
      const col = (this.fields[dim] || {}).label || dim;

      if (filter.values && filter.values.length > 0) {
        const placeholders = filter.values.map(v => bind(v)).join(', ');
        conditions.push(`${col} IN (${placeholders})`);
      }

      if (filter.searchText) {
        const pattern = filter.searchType === 'starts_with'
          ? `${filter.searchText}%`
          : `%${filter.searchText}%`;
        conditions.push(`${col} ILIKE ${bind(pattern)}`);
      }
    }
    return {
      where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
      params,
    };
  }

  /** Expands logical field names into real DB column names. */
  _expandFields(logicalFields) {
    const cols = [];
    for (const field of logicalFields) {
      const def = this.fields[field] || {};
      if (def.sortKey) cols.push(def.sortKey);
      cols.push(def.label || field);
    }
    return cols;
  }

  _makeStore(logicalFields, rows) {
    const dims = this._expandFields(logicalFields);
    const store = new ColumnStore({
      dimensions: dims,
      measures: this.measures,
      funcs: this.funcs,
      capacity: this.maxCachedRows,
    });
    store.append(rows);
    return store;
  }

  /**
   * Builds a parameterized equality WHERE clause from a context object
   * (used for drillthrough). Column names come from the trusted config;
   * only the values are bound as SQL parameters.
   * @returns {{ where: string, params: object }}
   */
  _buildWhere(filters) {
    const keys = Object.keys(filters);
    const params = {};
    let i = 0;
    if (!keys.length) return { where: '', params };

    const conditions = keys.map(k => {
      const def = this.fields[k] || {};
      const col = def.label || k;
      const key = `p${i++}`;
      params[key] = filters[k];
      return `${col} = %(${key})s`;
    });
    return { where: 'WHERE ' + conditions.join(' AND '), params };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  async _execute(query, params = {}) {
    let page = 0;
    let allRows = [];
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, page, params }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Server error ${res.status}: ${err.error || ''}`);
      }

      const data = await res.json();
      allRows = allRows.concat(data.rows);
      hasMore = data.hasMore;
      page++;
    }

    return allRows.map(row => {
      const out = {};
      for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
      return out;
    });
  }

  async load() {
    throw new Error('Use prefetch() / getRowsForDims() / drillthrough()');
  }
}
