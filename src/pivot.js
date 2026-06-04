/**
 * PivotGrid — vanilla JS
 * v0.3 — hierarchical columns, absolute-positioned headers
 */

class PivotGrid {

  static ROW_HEIGHT = 24;
  static HEADER_HEIGHT = 32;
  static COL_HEADER_W = 200;
  static COL_W = 150;
  static INDENT = 16;
  static BUFFER = 5;

  /**
   * @param {object}   options
   * @param {Element}  options.container  — DOM element to render into
   * @param {object}   options.result     — aggregation result from Aggregator.build()
   * @param {string[]} options.rows       — active row dimension names
   * @param {string[]} options.columns    — active column dimension names
   * @param {string}   options.measure    — active measure name
   * @param {object}   [options.fieldDefs={}] — field definitions (label, title, sortKey)
   * @param {object}   [options.labels={}]    — translated UI strings (total, confirmLargeExpand)
   */
  constructor({ container, result, rows, columns, measure, fieldDefs = {}, labels = {} }) {
    this.container = container;
    this.rows = rows;
    this.columns = columns;
    this.measure = measure;
    this.fieldDefs = fieldDefs;
    this._labels = labels;
    this._measureKey = measure + '_sum'; // updated via setMeasure()
    this._colHeaderW = PivotGrid.COL_HEADER_W;
    this._hideSubtotals = false;

    this.collapsed = new Set();
    this.collapsedCols = new Set();
    this.rowPool = [];
    this.rendered = new Map();

    this._applyResult(result);
    this._mount();
    this._renderVisible();
    this._bindScroll();
  }

  // ── Apply Result ────────────────────────────────────────────────────

  /** Applies an aggregation result object and rebuilds flat rows/cols. */
  _applyResult(result) {
    this.cells = result.cells;
    this.colTree = result.colTree;
    this.colKeys = result.colKeys;
    this.tree = result.tree;
    this.grandTotal = result.grandTotal;
    if (result.measureKey) this._measureKey = result.measureKey;
    this._buildFlatCols();
    this._buildFlatRows();
  }

  // ── Flat list of visible columns ────────────────────────────────────────

  /** Builds this.flatCols — the ordered list of visible leaf/subtotal column entries. */
  _buildFlatCols() {
    if (!this.colTree || !this.colTree.length) {
      this.flatCols = [];
      return;
    }

    const result = [];
    const multiLevel = this.columns && this.columns.length > 1;

    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.children) {
          if (this.collapsedCols.has(node.code)) {
            result.push({ code: node.code, label: node.value, isSubtotal: true, collapsed: true });
          } else {
            walk(node.children);
            if (multiLevel && !this._hideSubtotals) {
              result.push({ code: node.code, label: '∑', isSubtotal: true, collapsed: false });
            }
          }
        } else {
          result.push({ code: node.code, label: node.value, isSubtotal: false });
        }
      }
    };

    walk(this.colTree);
    this.flatCols = result;
  }

  /**
   * Number of flatCols occupied by a node (recursive, respects collapsed state).
   */
  _getGroupSpan(node) {
    if (!node.children || this.collapsedCols.has(node.code)) return 1;
    const multiLevel = this.columns && this.columns.length > 1;
    let span = (multiLevel && !this._hideSubtotals) ? 1 : 0;
    for (const child of node.children) {
      span += this._getGroupSpan(child);
    }
    return span;
  }

  /**
   * Depth of the column tree, accounting for collapsed nodes.
   */
  _colTreeDepth() {
    if (!this.colTree || !this.colTree.length) return 1;
    const walk = (nodes) => {
      let max = 0;
      for (const node of nodes) {
        if (node.children && !this.collapsedCols.has(node.code)) {
          max = Math.max(max, 1 + walk(node.children));
        }
      }
      return max;
    };
    return 1 + walk(this.colTree);
  }

  // ── Flat list of strings ──────────────────────────────────────────────────

  /** Builds this.flatRows — flat array of visible row nodes including grand total. */
  _buildFlatRows() {
    this.flatRows = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        this.flatRows.push(node);
        if (node.children && !this.collapsed.has(node.code)) {
          walk(node.children);
        }
      }
    };
    if (this.tree) walk(this.tree);
    this.flatRows.push({ isGrandTotal: true });
  }

  /** Total header height in px (HEADER_HEIGHT × column tree depth). */
  get _headerHeight() {
    return PivotGrid.HEADER_HEIGHT * this._colTreeDepth();
  }

  // ── Mounting ───────────────────────────────────────────────────────────

  /** Clears the container and mounts the column header + scroll area. */
  _mount() {
    this.container.innerHTML = '';
    this.container.classList.add('pg-root');

    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this.totalWidth = this._colHeaderW + (cols.length + 1) * PivotGrid.COL_W;

    this._mountColHeader();
    this._mountScrollArea();
  }

  /** Builds and appends the absolute-positioned column header element. */
  _mountColHeader() {
    const RH = PivotGrid.HEADER_HEIGHT;
    const C = this._colHeaderW;
    const W = PivotGrid.COL_W;
    const totalDepth = this._colTreeDepth();
    const H = RH * totalDepth;

    this.headerEl = document.createElement('div');
    this.headerEl.className = 'pg-col-header';
    this.headerEl.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: ${this.totalWidth}px; height: ${H}px;
      background: #fafafa; border-bottom: 1px solid #d0d0d0; z-index: 10;
    `;

    // Row label — full height
    const rowLabelCell = this._absCell({
      x: 0, y: 0, w: C, h: H,
      text: '',
      cls: 'row-label',
    });

    this.rows.forEach((row, i) => {
      const span = document.createElement('span');
      const def = (this.fieldDefs || {})[row] || {};
      span.textContent = def.title || def.label || row;
      span.style.cssText = 'cursor:pointer; padding: 0 2px;';
      span.title = `Expand to "${row}"`;
      if (i < this.rows.length - 1) {
        span.addEventListener('click', () => this.expandToDepth(i + 1));
      } else {
        span.style.cursor = 'default';
      }
      if (i > 0) {
        const sep = document.createElement('span');
        sep.textContent = ' › ';
        sep.style.color = '#ccc';
        rowLabelCell.appendChild(sep);
      }
      rowLabelCell.appendChild(span);
    });

    // Resize handle for the first column
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'pg-col-resize-handle';
    resizeHandle.style.cssText = `
      position: absolute; top: 0; left: ${C - 4}px;
      width: 8px; height: ${H}px;
      cursor: col-resize; z-index: 20;
    `;
    this.headerEl.appendChild(resizeHandle);
    this._bindResizeHandle(resizeHandle);

    // Columns
    if (this.colTree && this.colTree.length) {
      let offset = 0;
      for (const node of this.colTree) {
        offset = this._renderColNode(node, 0, offset, totalDepth);
      }
    }

    // Total — full height
    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this._absCell({
      x: C + cols.length * W,
      y: 0,
      w: W,
      h: H,
      text: this._labels.total || 'Total',
      cls: 'total-col',
    });

    this.container.appendChild(this.headerEl);
  }

  /**
   * Recursively renders a column header cell with absolute positioning.
   * Returns the new leafOffset.
   */
  _renderColNode(node, level, leafOffset, totalDepth) {
    const RH = PivotGrid.HEADER_HEIGHT;
    const C = this._colHeaderW;
    const W = PivotGrid.COL_W;
    const collapsed = this.collapsedCols.has(node.code);
    const isLeaf = !node.children;
    const span = this._getGroupSpan(node);

    // Листья и свёрнутые растягиваются до конца заголовка
    const cellH = (isLeaf || collapsed)
      ? (totalDepth - level) * RH
      : RH;

    const cls = collapsed ? 'subtotal-col'
      : isLeaf ? ''
        : 'pg-col-header-group';

    const cell = this._absCell({
      x: C + leafOffset * W,
      y: level * RH,
      w: span * W,
      h: cellH,
      text: node.value,
      cls,
    });

    // Collapse toggle button
    if (node.children) {
      const toggle = document.createElement('span');
      toggle.className = 'pg-toggle' + (collapsed ? ' collapsed' : '');
      toggle.textContent = '▾';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleColCollapse(node.code);
      });
      cell.insertBefore(toggle, cell.firstChild);
    }

    if (!isLeaf && !collapsed) {
      // Render children
      let childOffset = leafOffset;
      for (const child of node.children) {
        childOffset = this._renderColNode(child, level + 1, childOffset, totalDepth);
      }

      // ∑ for group — starts one level down, stretches to the end
      if (this.columns && this.columns.length > 1 && !this._hideSubtotals) {
        const subtotalH = (totalDepth - level - 1) * RH;
        if (subtotalH > 0) {
          this._absCell({
            x: C + (leafOffset + span - 1) * W,
            y: (level + 1) * RH,
            w: W,
            h: subtotalH,
            text: '∑',
            cls: 'subtotal-col',
          });
        }
      }
    }

    return leafOffset + span;
  }

  /**
   * Creates and appends an absolutely positioned cell to headerEl.
   */
  _absCell({ x, y, w, h, text, cls }) {
    const cell = document.createElement('div');
    cell.className = 'pg-col-header-cell' + (cls ? ' ' + cls : '');
    cell.style.cssText = `
      position: absolute;
      left: ${x}px; top: ${y}px;
      width: ${w}px; height: ${h}px;
      box-sizing: border-box;
    `;
    cell.textContent = text;
    this.headerEl.appendChild(cell);
    return cell;
  }

  /** Creates the scroll area div and the virtual space div inside it. */
  _mountScrollArea() {
    const H = this._headerHeight;

    this.scrollArea = document.createElement('div');
    this.scrollArea.className = 'pg-scroll';
    this.scrollArea.style.top = H + 'px';
    this.container.appendChild(this.scrollArea);

    this.virtualSpace = document.createElement('div');
    this.virtualSpace.style.cssText = `
      position: relative;
      width: ${this.totalWidth}px;
      height: ${this.flatRows.length * PivotGrid.ROW_HEIGHT}px;
    `;
    this.scrollArea.appendChild(this.virtualSpace);
  }

  // ── Virtualization ──────────────────────────────────────────────────────────

  /**
   * Renders only the rows currently in the viewport (+ BUFFER rows above/below).
   * Recycles rows that have scrolled out of view back into the pool.
   */
  _renderVisible() {
    const viewH = this.scrollArea.clientHeight;
    const scrollTop = this.scrollArea.scrollTop;
    const RH = PivotGrid.ROW_HEIGHT;
    const BUF = PivotGrid.BUFFER;

    const first = Math.max(0, Math.floor(scrollTop / RH) - BUF);
    const last = Math.min(
      this.flatRows.length - 1,
      Math.ceil((scrollTop + viewH) / RH) + BUF
    );

    for (const [idx, el] of this.rendered) {
      if (idx < first || idx > last) {
        this.virtualSpace.removeChild(el);
        this._recycleRow(el);
        this.rendered.delete(idx);
      }
    }

    for (let i = first; i <= last; i++) {
      if (this.rendered.has(i)) continue;
      const el = this._acquireRow();
      this._fillRow(el, this.flatRows[i], i);
      this.virtualSpace.appendChild(el);
      this.rendered.set(i, el);
    }
  }

  /** Returns a recycled or newly created row element. */
  _acquireRow() {
    if (this.rowPool.length) {
      const el = this.rowPool.pop();
      el.className = 'pg-row';
      el.removeAttribute('style');
      el.innerHTML = '';
      return el;
    }
    const el = document.createElement('div');
    el.className = 'pg-row';
    return el;
  }

  /** Returns a row element to the pool for reuse. */
  _recycleRow(el) {
    this.rowPool.push(el);
  }

  // ── Filling the Line ──────────────────────────────────────────────────────

  /**
   * Fills a row element with header cell and value cells for the given node.
   * @param {Element} el   — row element from the pool
   * @param {object}  node — flat row node (or { isGrandTotal: true })
   * @param {number}  idx  — row index in flatRows
   */
  _fillRow(el, node, idx) {
    const RH = PivotGrid.ROW_HEIGHT;
    el.style.top = idx * RH + 'px';
    el.style.width = this.totalWidth + 'px';
    el.style.height = RH + 'px';

    if (node.isGrandTotal) {
      el.classList.add('grand-total');
      this._fillGrandTotalRow(el);
      return;
    }

    el.style.background = idx % 2 === 0 ? '#ffffff' : '#fcfcfc';
    this._fillHeaderCell(el, node);
    this._fillValueCells(el, node);
  }

  /**
   * Appends the sticky left header cell (label + expand/collapse toggle) to a row.
   * @param {Element} el   — row element
   * @param {object}  node — row tree node
   */
  _fillHeaderCell(el, node) {
    const RH = PivotGrid.ROW_HEIGHT;
    const C = this._colHeaderW;
    const I = PivotGrid.INDENT;

    const cell = document.createElement('div');
    cell.className = 'pg-cell-header';
    cell.style.cssText = `width:${C}px;height:${RH}px;padding-left:${8 + node.depth * I}px`;

    if (node.children) {
      const toggle = document.createElement('span');
      toggle.className = 'pg-toggle' + (this.collapsed.has(node.code) ? ' collapsed' : '');
      toggle.textContent = '▾';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleCollapse(node.code);
      });
      cell.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'pg-toggle-spacer';
      cell.appendChild(spacer);
    }

    const label = document.createElement('span');
    label.className = `pg-label depth-${Math.min(node.depth, 2)}`;
    label.textContent = node.value;
    cell.appendChild(label);

    el.appendChild(cell);
  }

  /**
   * Appends all value cells (one per column + one total) to a row.
   * Each cell fires a drillthrough event on click.
   * @param {Element} el   — row element
   * @param {object}  node — row tree node
   */
  _fillValueCells(el, node) {
    const RH = PivotGrid.ROW_HEIGHT;
    const W = PivotGrid.COL_W;
    const cols = this.flatCols.length ? this.flatCols : this.colKeys;

    for (const col of cols) {
      const key = node.code + '||' + col.code;
      const val = this.cells.get(key);
      const cell = document.createElement('div');
      cell.className = 'pg-cell'
        + (val == null ? ' empty' : '')
        + (col.isSubtotal ? ' subtotal' : '');
      cell.style.cssText = `width:${W}px;height:${RH}px`;
      cell.textContent = val != null ? this._fmt(val) : '—';
      if (val != null) {
        cell.addEventListener('click', () => this._emitDrillthrough(node, col.code, val));
      }
      el.appendChild(cell);
    }

    const totalKey = node.code + '||__total__';
    const totalVal = this.cells.get(totalKey) || 0;
    const totalCell = document.createElement('div');
    totalCell.className = 'pg-cell total';
    totalCell.style.cssText = `width:${W}px;height:${RH}px`;
    totalCell.textContent = this._fmt(totalVal);
    totalCell.addEventListener('click', () => this._emitDrillthrough(node, '__total__', totalVal));
    el.appendChild(totalCell);
  }

  /**
   * Fills the grand total row: header label + column totals + overall grand total.
   * @param {Element} el — row element
   */
  _fillGrandTotalRow(el) {
    const RH = PivotGrid.ROW_HEIGHT;
    const C = this._colHeaderW;
    const W = PivotGrid.COL_W;
    const cols = this.flatCols.length ? this.flatCols : this.colKeys;

    const headerCell = document.createElement('div');
    headerCell.className = 'pg-cell-header';
    headerCell.style.cssText = `width:${C}px;height:${RH}px;padding-left:8px`;

    const spacer = document.createElement('span');
    spacer.className = 'pg-toggle-spacer';
    headerCell.appendChild(spacer);

    const label = document.createElement('span');
    label.className = 'pg-label depth-0';
    label.textContent = this._labels.total || 'Total';
    headerCell.appendChild(label);
    el.appendChild(headerCell);

    for (const col of cols) {
      const key = '__grand__||' + col.code;
      const val = this.cells.get(key) || 0;
      const cell = document.createElement('div');
      cell.className = 'pg-cell total' + (col.isSubtotal ? ' subtotal' : '');
      cell.style.cssText = `width:${W}px;height:${RH}px`;
      cell.textContent = this._fmt(val);
      cell.addEventListener('click', () =>
        this._emitDrillthrough({ isGrandTotal: true }, col.code, val)
      );
      el.appendChild(cell);
    }

    const grandCell = document.createElement('div');
    grandCell.className = 'pg-cell total grand-total-val';
    grandCell.style.cssText = `width:${W}px;height:${RH}px`;
    grandCell.textContent = this._fmt(this.grandTotal || 0);
    grandCell.addEventListener('click', () =>
      this._emitDrillthrough({ isGrandTotal: true }, '__total__', this.grandTotal)
    );
    el.appendChild(grandCell);
  }

  // ── Collapse columns ───────────────────────────────────────────────────────

  /**
   * Toggles collapse state of a column group.
   * When expanding, collapses direct children to avoid overloading the view.
   * @param {string} code — column node code
   */
  _toggleColCollapse(code) {
    if (this.collapsedCols.has(code)) {
      this.collapsedCols.delete(code);
      // Collapse direct children
      const node = this._findColNode(code);
      if (node?.children) {
        for (const child of node.children) {
          if (child.children) this.collapsedCols.add(child.code);
        }
      }
    } else {
      this.collapsedCols.add(code);
    }
    this._rebuildCols();
  }

  /**
   * Finds a column tree node by its code (recursive).
   * @param {string}   code
   * @param {object[]} [nodes=this.colTree]
   * @returns {object|null}
   */
  _findColNode(code, nodes = this.colTree) {
    if (!nodes) return null;
    for (const node of nodes) {
      if (node.code === code) return node;
      const found = this._findColNode(code, node.children);
      if (found) return found;
    }
    return null;
  }

  /**
   * Shows or hides subtotal columns in multi-level column mode.
   * @param {boolean} show
   */
  toggleSubtotals(show) {
    this._hideSubtotals = !show;
    this._rebuildCols();
  }

  /** Rebuilds flat columns and re-renders the column header and grid. */
  _rebuildCols() {
    this._buildFlatCols();
    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this.totalWidth = this._colHeaderW + (cols.length + 1) * PivotGrid.COL_W;
    this.virtualSpace.style.width = this.totalWidth + 'px';
    this.scrollArea.style.top = this._headerHeight + 'px';
    this.headerEl.remove();
    this._mountColHeader();
    this.headerEl.style.transform = `translateX(-${this.scrollArea.scrollLeft}px)`;
    this._redraw();
  }

  // ── Redraw ─────────────────────────────────────────────────────────────────

  /** Clears all rendered rows and re-renders the visible viewport. */
  _redraw() {
    this.virtualSpace.style.height =
      this.flatRows.length * PivotGrid.ROW_HEIGHT + 'px';

    for (const [, el] of this.rendered) {
      this.virtualSpace.removeChild(el);
      this._recycleRow(el);
    }
    this.rendered.clear();
    this._renderVisible();
  }

  // ── Scroll ─────────────────────────────────────────────────────────────────

  /** Binds the scroll event — syncs header position and triggers virtual render. */
  _bindScroll() {
    let ticking = false;
    this.scrollArea.addEventListener('scroll', () => {
      this.headerEl.style.transform =
        `translateX(-${this.scrollArea.scrollLeft}px)`;

      if (!ticking) {
        requestAnimationFrame(() => {
          this._renderVisible();
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ── Drillthrough ───────────────────────────────────────────────────────────

  /**
   * Builds a context object from the clicked cell and dispatches a
   * custom "drillthrough" event on the container.
   * @param {object} node    — row node (or { isGrandTotal: true })
   * @param {string} colCode — column code or "__total__"
   * @param {number} value   — aggregated cell value
   */
  _emitDrillthrough(node, colCode, value) {
    const context = {};

    if (!node.isGrandTotal) {
      const chain = this._getNodeChain(node);
      for (let i = 0; i < chain.length; i++) {
        context[this.rows[i]] = chain[i].value;
      }
    }

    if (colCode !== '__total__') {
      const parts = colCode.split('→');
      for (let i = 0; i < parts.length; i++) {
        if (this.columns[i]) context[this.columns[i]] = parts[i];
      }
    }

    // context holds logical field names — provider handles the mapping
    this.container.dispatchEvent(new CustomEvent('drillthrough', {
      bubbles: true,
      detail: { context, value },
    }));
  }

  /**
   * Walks flatRows upward to build the ancestor chain for a given node.
   * Used to construct the drillthrough context.
   * @param {object} node
   * @returns {object[]}
   */
  _getNodeChain(node) {
    const chain = [node];
    if (node.depth === 0) return chain;

    const idx = this.flatRows.indexOf(node);
    for (let i = idx - 1; i >= 0; i--) {
      const n = this.flatRows[i];
      if (n.isGrandTotal) continue;
      if (n.depth === node.depth - 1) {
        chain.unshift(n);
        if (n.depth === 0) break;
        node = n;
      }
    }
    return chain;
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  /** Formats a numeric value with locale-aware thousand separators. */
  _fmt(val) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(val);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Binds mousedown drag on the resize handle to adjust the row-label column width.
   * @param {Element} handle
   */
  _bindResizeHandle(handle) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = this._colHeaderW;

      const onMove = (mv) => {
        //const newW = Math.max(80, startW + mv.clientX - startX);
        const newW = Math.max(PivotGrid.COL_HEADER_W, startW + mv.clientX - startX);
        this._colHeaderW = newW;
        this._rebuild();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /** Full rebuild after column width change: remounts header and re-renders rows. */
  _rebuild() {
    this.headerEl?.remove();
    this.headerEl = null;
    this._buildFlatCols();
    this._mountColHeader();
    for (const [, el] of this.rendered) this._recycleRow(el);
    this.rendered.clear();
    this._renderVisible();
  }

  /** Instant measure/function change — no aggregate recalculation. */
  // setMeasure(measure, func) {
  //   this._measureKey = measure + '_' + func;
  //   for (const [, el] of this.rendered) this._recycleRow(el);
  //   this.rendered.clear();
  //   this._renderVisible();
  // }

  /**
   * Replaces the current aggregation result and re-renders the grid.
   * Top-level column groups are collapsed automatically.
   * @param {object}   result
   * @param {object}   [options]
   * @param {string[]} [options.rows]
   * @param {string[]} [options.columns]
   * @param {string}   [options.measure]
   * @param {object}   [options.fieldDefs]
   */
  setResult(result, { rows, columns, measure, fieldDefs } = {}) {
    if (rows) this.rows = rows;
    if (columns) this.columns = columns;
    if (measure) this.measure = measure;
    if (fieldDefs) this.fieldDefs = fieldDefs;
    this.collapsedCols.clear();
    this._applyResult(result);

    // Collapse all top-level column groups
    if (this.colTree) {
      for (const node of this.colTree) {
        if (node.children) this.collapsedCols.add(node.code);
      }
      this._buildFlatCols();
    }

    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this.totalWidth = this._colHeaderW + (cols.length + 1) * PivotGrid.COL_W;
    this.virtualSpace.style.width = this.totalWidth + 'px';
    this.scrollArea.style.top = this._headerHeight + 'px';

    this.headerEl.remove();
    this._mountColHeader();
    this._redraw();
  }

  /** Collapses all row nodes and redraws. */
  collapseAll() {
    const walk = (nodes) => {
      if (!nodes) return;
      for (const node of nodes) {
        if (node.children) {
          this.collapsed.add(node.code);
          walk(node.children);
        }
      }
    };
    walk(this.tree);
    this._buildFlatRows();
    this._redraw();
  }

  /**
   * Detects the maximum scrollable height supported by the current browser.
   * Used to cap MAX_FLAT_ROWS and prevent invisible rows.
   * @returns {number}
   */
  static _detectMaxHeight() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;visibility:hidden;';
    document.body.appendChild(el);
    let h = 1_000_000;
    while (h < 100_000_000) {
      el.style.height = h + 'px';
      if (el.offsetHeight < h) break;
      h *= 2;
    }
    el.remove();
    return h / 2;
  }

  static MAX_FLAT_ROWS = Math.floor(PivotGrid._detectMaxHeight() / PivotGrid.ROW_HEIGHT);

  /**
   * Shows a confirm dialog when the expanded row count exceeds MAX_FLAT_ROWS.
   * @param {number}   count     — total rows after expand
   * @param {Function} onConfirm — called if user confirms
   * @param {Function} [onCancel] — called if user cancels
   */
  _confirmLargeExpand(count, onConfirm, onCancel) {
    const millions = (count / 1_000_000).toFixed(1);
    const msg = (this._labels.confirmLargeExpand || 'Too many rows (~{millions}M). Click OK to expand anyway.').replace('{millions}', millions);
    if (window.confirm(msg)) onConfirm();
    else onCancel?.();
  }

  /**
   * Toggles a row node's collapsed state and redraws.
   * Prompts confirmation if the resulting row count exceeds MAX_FLAT_ROWS.
   * @param {string} code — row node code
   */
  _toggleCollapse(code) {
    const wasCollapsed = this.collapsed.has(code);
    if (wasCollapsed) this.collapsed.delete(code);
    else this.collapsed.add(code);

    this._buildFlatRows();

    if (wasCollapsed && this.flatRows.length > PivotGrid.MAX_FLAT_ROWS) {
      this._confirmLargeExpand(this.flatRows.length,
        () => this._redraw(),
        () => {
          this.collapsed.add(code);
          this._buildFlatRows();
        }
      );
      return;
    }

    this._redraw();
  }

  /**
   * Expands rows up to the given depth. Clicking a depth level again collapses it.
   * @param {number} depth — 1-based depth level
   */
  expandToDepth(depth) {
    const nodesAtDepth = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (!node.children) continue;
        if (node.depth < depth - 1) {
          this.collapsed.delete(node.code);
          walk(node.children);
        } else if (node.depth === depth - 1) {
          nodesAtDepth.push(node);
          // leave children untouched
        }
      }
    };
    walk(this.tree);

    const anyExpanded = nodesAtDepth.some(n => !this.collapsed.has(n.code));
    for (const n of nodesAtDepth) {
      if (anyExpanded) this.collapsed.add(n.code);
      else this.collapsed.delete(n.code);
    }

    this._buildFlatRows();
    this._redraw();
  }

  /** Expands all row nodes. Prompts confirmation if row count exceeds MAX_FLAT_ROWS. */
  expandAll() {
    this.collapsed.clear();
    this._buildFlatRows();

    if (this.flatRows.length > PivotGrid.MAX_FLAT_ROWS) {
      this._confirmLargeExpand(this.flatRows.length, () => this._redraw());
      return;
    }

    this._redraw();
  }

  /** Expands all column groups. */
  expandAllCols() {
    this.collapsedCols.clear();
    this._rebuildCols();
  }

  /** Collapses all column groups. */
  collapseAllCols() {
    const walk = (nodes) => {
      if (!nodes) return;
      for (const node of nodes) {
        if (node.children) {
          this.collapsedCols.add(node.code);
          walk(node.children);
        }
      }
    };
    walk(this.colTree);
    this._rebuildCols();
  }
}
