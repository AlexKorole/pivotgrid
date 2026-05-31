/**
 * RestProvider
 *
 * Стратегия кэширования:
 *   - При старте один GROUP BY по cachedDimensions → кэш (ColumnStore)
 *   - Всё остальное — lazy, без кэширования
 *   - countRows(dims) → COUNT запрос для UI-валидации перед добавлением в кэш
 *   - refreshCache(dims) → сброс кэша + новый GROUP BY
 */
class RestProvider {

  constructor({ url, query, dimensions, measures, funcs, fields = {},
                cachedDimensions = [], maxCachedRows = 500_000, drillthroughQuery = null }) {
    this.url           = url;
    this.query         = query;
    this.dimensions    = dimensions;
    this.measures      = measures;
    this.funcs         = funcs;
    this.fields        = fields;
    this.maxCachedRows = maxCachedRows;

    this._cachedDims = [...cachedDimensions];
    this._store      = null;  // единственный ColumnStore-кэш
    this._cacheRows  = 0;     // строк в кэше после последнего prefetch

    this.drillthroughQuery = drillthroughQuery;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Первоначальная загрузка: один GROUP BY по cachedDimensions.
   * Если список пуст — ничего не делает.
   */
  async prefetch() {
    this._store     = null;
    this._cacheRows = 0;

    if (!this._cachedDims.length) return;

    const rows      = await this._fetchGroupBy(this._cachedDims);
    this._store     = this._makeStore(this._cachedDims, rows);
    this._cacheRows = rows.length;
  }

  /**
   * COUNT строк GROUP BY для заданного набора измерений.
   * Используется CacheManager для валидации перед добавлением измерения.
   * @param {string[]} logicalFields — логические имена (из CONFIG.dimensions)
   * @returns {Promise<number>}
   */
  async countRows(logicalFields) {
    if (!logicalFields.length) return 0;
    const cols = this._expandFields(logicalFields).join(', ');
    const sql  = `
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
   * Очищает кэш и перезагружает GROUP BY по новому набору измерений.
   * Вызывается по кнопке «Обновить кэш».
   */
  async refreshCache(newDims) {
    this._cachedDims = [...newDims];
    await this.prefetch();
  }

  /** Текущий список кэшируемых измерений. */
  get cachedDimensions() { return [...this._cachedDims]; }

  /** Кол-во строк в кэше (обновляется после prefetch/refreshCache). */
  get cacheRows() { return this._cacheRows; }

  // ── Получение данных для грида ─────────────────────────────────────────────

  /**
   * Возвращает итерируемые строки из кэша, если кэш покрывает requiredDims.
   * Иначе — null.
   */
  getBestRows(requiredDims = [], activeFilters = {}) {
    if (!this._store) return null;

    const hasAllRequired = requiredDims.every(dim => {
      const col = (this.fields[dim] || {}).label || dim;
      return this._store.dimensions.includes(col);
    });
    if (!hasAllRequired) return null;

    // Если хоть одно измерение фильтра не в store — идём в lazy SQL с WHERE
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
   * Фильтрует строки из кэша по активным фильтрам (без запроса на сервер).
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

    // Материализуем в массив — стабильно и предсказуемо
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
    const def     = this.fields[logicalField] || {};
    const col     = def.label    || logicalField;
    const sortCol = def.sortKey  || col;
    const sql     = `SELECT DISTINCT ${col} FROM (${this.query}) _t ORDER BY ${sortCol}`;
    const rows    = await this._execute(sql);
    return rows.map(r => String(r[col] ?? ''));
  }

  async drillthrough({ filters = {}, limit = 100, offset = 0 }) {
    const where = this._buildWhere(filters);
    const sql   = `
      SELECT *
      FROM   (${this.query}) _t
      ${where}
      LIMIT  ${limit} OFFSET ${offset}
    `;
    return this._execute(sql);
  }

  // ── SQL helpers ────────────────────────────────────────────────────────────

  _fetchGroupBy(logicalFields, activeFilters = {}) {
    const select  = [];
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

    const where = this._buildFiltersWhere(activeFilters);

    const sql = `
      SELECT ${[...select, aggExprs].join(', ')}
      FROM   (${this.query}) _t
      ${where}
      GROUP  BY ${groupBy.join(', ')}
      ORDER  BY ${orderBy.join(', ')}
    `;

    return this._execute(sql);
  }

  /** Строит WHERE для активных фильтров (для SQL запросов). */
  _buildFiltersWhere(activeFilters = {}) {
    const conditions = [];
    for (const [dim, filter] of Object.entries(activeFilters)) {
      const col = (this.fields[dim] || {}).label || dim;

      if (filter.values && filter.values.length > 0) {
        const vals = filter.values
          .map(v => `'${String(v).replace(/'/g, "''")}'`)
          .join(', ');
        conditions.push(`${col} IN (${vals})`);
      }

      if (filter.searchText) {
        const esc = filter.searchText.replace(/'/g, "''");
        conditions.push(filter.searchType === 'starts_with'
          ? `${col} ILIKE '${esc}%'`
          : `${col} ILIKE '%${esc}%'`
        );
      }
    }
    return conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  }

  /** Раскрывает логические имена полей в реальные колонки БД. */
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
    const dims  = this._expandFields(logicalFields);
    const store = new ColumnStore({
      dimensions: dims,
      measures:   this.measures,
      funcs:      this.funcs,
      capacity:   this.maxCachedRows,
    });
    store.append(rows);
    return store;
  }

  _buildWhere(filters) {
    const keys = Object.keys(filters);
    if (!keys.length) return '';
    return 'WHERE ' + keys.map(k => {
      const def = this.fields[k] || {};
      const col = def.label || k;
      return `${col} = '${String(filters[k]).replace(/'/g, "''")}'`;
    }).join(' AND ');
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  async _execute(query) {
    const res = await fetch(this.url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Server error ${res.status}: ${err.error || ''}`);
    }

    const rows = await res.json();
    return rows.map(row => {
      const out = {};
      for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
      return out;
    });
  }

  async load() {
    throw new Error('Use prefetch() / getRowsForDims() / drillthrough()');
  }

  async drillthrough({ filters = {} }) {
    const where = this._buildWhere(filters);
    const sql = this.drillthroughQuery
      ? this.drillthroughQuery.replace('{filters}', where ? where.replace('WHERE ', '') : '1=1')
      : `SELECT * FROM (${this.query}) _t ${where} LIMIT 200`;
    return this._execute(sql);
  }
}
