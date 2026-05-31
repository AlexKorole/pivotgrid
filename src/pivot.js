/**
 * PivotGrid — vanilla JS
 * v0.3 — иерархические колонки, абсолютное позиционирование заголовков
 */

class PivotGrid {

  static ROW_HEIGHT = 24;
  static HEADER_HEIGHT = 32;
  static COL_HEADER_W = 200;
  static COL_W = 150;
  static INDENT = 16;
  static BUFFER = 5;

  constructor({ container, result, rows, columns, measure, fieldDefs = {} }) {
    this.container = container;
    this.rows = rows;
    this.columns = columns;
    this.measure = measure;
    this.fieldDefs = fieldDefs;
    this._measureKey = measure + '_sum'; // будет обновлён через setMeasure()
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

  // ── Применить результат ────────────────────────────────────────────────────

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

  // ── Плоский список видимых колонок ────────────────────────────────────────

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
   * Сколько flatCols занимает узел (рекурсивно, с учётом свёрнутых).
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
   * Глубина дерева колонок с учётом свёрнутых узлов.
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

  // ── Плоский список строк ──────────────────────────────────────────────────

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

  get _headerHeight() {
    return PivotGrid.HEADER_HEIGHT * this._colTreeDepth();
  }

  // ── Монтирование ───────────────────────────────────────────────────────────

  _mount() {
    this.container.innerHTML = '';
    this.container.classList.add('pg-root');

    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this.totalWidth = this._colHeaderW + (cols.length + 1) * PivotGrid.COL_W;

    this._mountColHeader();
    this._mountScrollArea();
  }

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

    // Row label — на всю высоту
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
      span.title = `Развернуть до "${row}"`;
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

    // Ручка изменения ширины первой колонки
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'pg-col-resize-handle';
    resizeHandle.style.cssText = `
      position: absolute; top: 0; left: ${C - 4}px;
      width: 8px; height: ${H}px;
      cursor: col-resize; z-index: 20;
    `;
    this.headerEl.appendChild(resizeHandle);
    this._bindResizeHandle(resizeHandle);

    // Колонки
    if (this.colTree && this.colTree.length) {
      let offset = 0;
      for (const node of this.colTree) {
        offset = this._renderColNode(node, 0, offset, totalDepth);
      }
    }

    // Итого — на всю высоту
    const cols = this.flatCols.length ? this.flatCols : this.colKeys;
    this._absCell({
      x: C + cols.length * W,
      y: 0,
      w: W,
      h: H,
      text: 'Итого',
      cls: 'total-col',
    });

    this.container.appendChild(this.headerEl);
  }

  /**
   * Рекурсивно рисует ячейку заголовка колонки с абсолютным позиционированием.
   * Возвращает новый leafOffset.
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

    // Кнопка сворачивания
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
      // Рендерим детей
      let childOffset = leafOffset;
      for (const child of node.children) {
        childOffset = this._renderColNode(child, level + 1, childOffset, totalDepth);
      }

      // ∑ для группы — начинается уровнем ниже, растягивается до конца
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
   * Создаёт и добавляет абсолютно позиционированную ячейку в headerEl.
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

  // ── Виртуализация ──────────────────────────────────────────────────────────

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

  _recycleRow(el) {
    this.rowPool.push(el);
  }

  // ── Заполнение строки ──────────────────────────────────────────────────────

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
    label.textContent = 'Итого';
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

  // ── Collapse колонок ───────────────────────────────────────────────────────

  _toggleColCollapse(code) {
    if (this.collapsedCols.has(code)) {
      this.collapsedCols.delete(code);
      // Сворачиваем прямых детей
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

  _findColNode(code, nodes = this.colTree) {
    if (!nodes) return null;
    for (const node of nodes) {
      if (node.code === code) return node;
      const found = this._findColNode(code, node.children);
      if (found) return found;
    }
    return null;
  }

  toggleSubtotals(show) {
    this._hideSubtotals = !show;
    this._rebuildCols();
  }

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

    // context содержит логические имена — пусть провайдер сам маппит
    this.container.dispatchEvent(new CustomEvent('drillthrough', {
      bubbles: true,
      detail: { context, value },
    }));
  }

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

  // ── Утилиты ────────────────────────────────────────────────────────────────

  _fmt(val) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(val);
  }

  // ── Публичный API ──────────────────────────────────────────────────────────

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

  _rebuild() {
    this.headerEl?.remove();
    this.headerEl = null;
    this._buildFlatCols();
    this._mountColHeader();
    for (const [, el] of this.rendered) this._recycleRow(el);
    this.rendered.clear();
    this._renderVisible();
  }

  /** Мгновенная смена меры/функции — без пересчёта агрегатов. */
  // setMeasure(measure, func) {
  //   this._measureKey = measure + '_' + func;
  //   for (const [, el] of this.rendered) this._recycleRow(el);
  //   this.rendered.clear();
  //   this._renderVisible();
  // }

  setResult(result, { rows, columns, measure, fieldDefs } = {}) {
    if (rows) this.rows = rows;
    if (columns) this.columns = columns;
    if (measure) this.measure = measure;
    if (fieldDefs) this.fieldDefs = fieldDefs;
    this.collapsedCols.clear();
    this._applyResult(result);

    // Сворачиваем все группы верхнего уровня колонок
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

  _confirmLargeExpand(count, onConfirm, onCancel) {
    const millions = (count / 1_000_000).toFixed(1);
    const msg = `Слишком много строк для отображения\n\n` +
      `После разворачивания грид будет содержать ~${millions} млн строк, ` +
      `что превышает возможности браузера. Часть данных в нижней части будет недоступна для прокрутки.\n\n` +
      `Рекомендуем свернуть часть измерений в строках или уменьшить количество уровней.\n\n` +
      `Нажмите ОК чтобы всё равно развернуть, Отмена чтобы отказаться.`;
    if (window.confirm(msg)) onConfirm();
    else onCancel?.();
  }

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
          // детей не трогаем
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

  expandAll() {
    this.collapsed.clear();
    this._buildFlatRows();

    if (this.flatRows.length > PivotGrid.MAX_FLAT_ROWS) {
      this._confirmLargeExpand(this.flatRows.length, () => this._redraw());
      return;
    }

    this._redraw();
  }

  expandAllCols() {
    this.collapsedCols.clear();
    this._rebuildCols();
  }

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
