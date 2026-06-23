/**
 * FieldZones
 *
 * Drag-and-drop zones for managing pivot fields.
 * Three zones: FIELDS (free) → ROWS → COLUMNS
 *
 * Drop logic: insertion position is determined by the placeholder in the DOM —
 * no recalculation in onUp, just read what is already in the DOM.
 */
class FieldZones {

  constructor({ root, dimensions, fields = {}, initialRows, initialColumns, initialFilters = [], onChange, onFilterOpen }) {
    this.root         = root;   // this widget's own container — scopes all DOM lookups and event guards
    this.dimensions   = dimensions;
    this._fieldDefs   = fields;
    this.onChange     = onChange;
    this.onFilterOpen = onFilterOpen;

    this.rows    = [...initialRows];
    this.columns = [...initialColumns];
    this.filters = [...initialFilters];

    this.filterSet = new Set(initialFilters);
    this.state = {};
    for (const dim of dimensions) {
      if (initialRows.includes(dim)) this.state[dim] = 'rows';
      else if (initialColumns.includes(dim)) this.state[dim] = 'columns';
      else this.state[dim] = 'free';
    }

    this._placeholder = null;
    this._render();
    this._bindEvents();
    this._lastMoved = null;
    this._filterHints = {};   // { dim → { badge, tooltip } }
    this._tooltip = document.createElement('div');
    this._tooltip.className = 'fz-tooltip';
    document.body.appendChild(this._tooltip);
    this._bindTooltip();
  }

  setFilterHints(hints) {
    this._filterHints = hints || {};
    this._renderZone('fz-chips-filters', 'filters');
  }

  _bindTooltip() {
    document.addEventListener('mouseover', (e) => {
      if (!this.root.contains(e.target)) return;
      const chip = e.target.closest('.fz-chip[data-zone="filters"]');
      const hint = chip && this._filterHints[chip.dataset.field];
      if (!hint) { this._tooltip.style.display = 'none'; return; }
      this._tooltip.textContent = hint.tooltip;
      this._tooltip.style.display = 'block';
    });

    document.addEventListener('mousemove', (e) => {
      if (this._tooltip.style.display === 'none') return;
      const t = this._tooltip;
      const x = Math.min(e.clientX + 12, window.innerWidth - t.offsetWidth - 8);
      const y = e.clientY - t.offsetHeight - 8;  // above cursor
      t.style.left = x + 'px';
      t.style.top = (y < 4 ? e.clientY + 16 : y) + 'px';  // if no space above — below cursor
    });

    document.addEventListener('mouseout', (e) => {
      if (!this.root.contains(e.target)) return;
      const chip = e.target.closest('.fz-chip[data-zone="filters"]');
      if (chip && !chip.contains(e.relatedTarget)) {
        this._tooltip.style.display = 'none';
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────
 
  _render() {
    this._renderZone('fz-chips-free',    'free');
    this._renderZone('fz-chips-rows',    'rows');
    this._renderZone('fz-chips-columns', 'columns');
    this._renderZone('fz-chips-filters', 'filters');
  }

  _renderZone(containerId, zone) {
    const el = this.root.querySelector('#' + containerId);
    if (!el) return;

    const fields = zone === 'rows'    ? this.rows
      : zone === 'columns' ? this.columns
      : zone === 'filters' ? [...this.filterSet]
      : this.dimensions.filter(d => this.state[d] === 'free' && !this.filterSet.has(d));

    el.innerHTML = fields.map(f => {
      const hint = (zone === 'filters') ? this._filterHints[f] : null;
      const tooltip = hint ? `${f}: ${hint.tooltip}` : f;
      return `
    <div class="fz-chip${hint ? ' fz-chip--filtered' : ''}"
         data-field="${f}" data-zone="${zone}" title="">
      <span class="fz-chip-label" draggable="false">${this._fieldDefs[f]?.title || this._fieldDefs[f]?.label || f}</span>
      ${hint ? `<span class="fz-chip-hint" draggable="false">${hint.badge}</span>` : ''}
      ${zone !== 'free'
          ? `<span class="fz-chip-remove" draggable="false" data-field="${f}" data-zone="${zone}">×</span>`
          : ''}
    </div>
    `;
    }).join('');

    if (zone === 'filters' && this.onFilterOpen) {
      el.querySelectorAll('.fz-chip').forEach(chip => {
        chip.querySelector('.fz-chip-label').addEventListener('click', (e) => {
          e.stopPropagation();
          this.onFilterOpen(chip.dataset.field, chip);
        });
      });
    }

    if (this._lastMoved) {
      const chip = el.querySelector(`[data-field="${this._lastMoved}"]`);
      chip?.classList.add('fz-chip--last');
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  _bindEvents() {
    document.addEventListener('mousedown', (e) => {
      if (!this.root.contains(e.target)) return;
      if (e.target.classList.contains('fz-chip-remove')) {
        e.stopPropagation();
        this._moveField(e.target.dataset.field, e.target.dataset.zone, 'free');
        return;
      }
      const chip = e.target.closest('.fz-chip');
      if (!chip) return;
      this._initDrag(e, chip);
    });
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  _initDrag(e, chip) {
    e.preventDefault();

    const field    = chip.dataset.field;
    const fromZone = chip.dataset.zone;
    const startX   = e.clientX;
    const startY   = e.clientY;
    let dragging   = false;
    let ghost      = null;

    const onMove = (mv) => {
      if (!dragging && Math.hypot(mv.clientX - startX, mv.clientY - startY) > 5) {
        dragging = true;
        chip.classList.add('fz-chip--dragging');
        ghost = this._createGhost(chip, mv);
      }
      if (!dragging) return;

      ghost.style.left = mv.clientX + 12 + 'px';
      ghost.style.top  = mv.clientY - 12 + 'px';

      // Hide ghost and dragging chip — otherwise elementFromPoint picks them up
      ghost.style.visibility = 'hidden';
      chip.style.visibility  = 'hidden';
      this._updatePlaceholder(mv);
      ghost.style.visibility = '';
      chip.style.visibility  = '';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);

      ghost?.remove();
      chip.classList.remove('fz-chip--dragging');
      chip.style.visibility = '';

      if (!dragging) {
        this._clearHighlight();
        return;
      }

      // Read final drop position from placeholder
      const ph = this._placeholder;
      if (!ph?.parentNode) {
        this._clearHighlight();
        return;
      }

      // Zone — placeholder container
      const zoneEl = ph.parentNode.closest('[data-fz-zone]') || ph.parentNode;
      const toZone = zoneEl.dataset.fzZone;

      // beforeField — first fz-chip after the placeholder
      const siblings    = [...ph.parentNode.children];
      const phIdx       = siblings.indexOf(ph);
      const afterChips  = siblings.slice(phIdx + 1).filter(el => el.classList.contains('fz-chip'));
      const beforeField = afterChips[0]?.dataset.field || null;

      this._clearHighlight();

      if (!toZone) return;

      if (toZone !== fromZone) {
        this._moveFieldBefore(field, fromZone, toZone, beforeField);
      } else {
        this._reorder(field, fromZone, beforeField);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Placeholder ──────────────────────────────────────────────────────────

  _updatePlaceholder(e) {
    this._clearHighlight();

    // Find zone under cursor — only valid if it belongs to this instance
    const zoneElRaw = document.elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-fz-zone]');
    const zoneEl = zoneElRaw && this.root.contains(zoneElRaw) ? zoneElRaw : null;
    if (zoneEl) zoneEl.classList.add('fz-zone--over');

    const ph = document.createElement('div');
    ph.className = 'fz-chip-placeholder';
    this._placeholder = ph;

    // Find chip under cursor — only valid if it belongs to this instance
    const targetRaw = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fz-chip');
    const target = targetRaw && this.root.contains(targetRaw) ? targetRaw : null;

    if (target && !target.classList.contains('fz-chip-placeholder')) {
      const rect         = target.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      target.parentNode.insertBefore(ph, insertBefore ? target : target.nextSibling);
    } else if (zoneEl) {
      // No chip target — append to end of zone
      const chipsContainer = zoneEl.querySelector('[id^="fz-chips"]') || zoneEl;
      chipsContainer.appendChild(ph);
    }
  }

  _clearHighlight() {
    this.root.querySelectorAll('[data-fz-zone]')
      .forEach(z => z.classList.remove('fz-zone--over'));
    this._placeholder?.remove();
    this._placeholder = null;
  }

  // ── Ghost ────────────────────────────────────────────────────────────────

  _createGhost(chip, e) {
    const ghost = chip.cloneNode(true);
    ghost.className = 'fz-chip fz-chip--ghost';
    Object.assign(ghost.style, {
      position:      'fixed',
      left:          e.clientX + 12 + 'px',
      top:           e.clientY - 12 + 'px',
      pointerEvents: 'none',
      zIndex:        '9999',
      opacity:       '0.85',
    });
    document.body.appendChild(ghost);
    return ghost;
  }

  // ── State mutations ──────────────────────────────────────────────────────

  _moveField(field, fromZone, toZone) {
    if (toZone === 'filters') {
      // Add to filters, do NOT remove from rows/columns
      this.filterSet.add(field);
    } else if (fromZone === 'filters') {
      // Remove from filters (× click), primary zone unchanged
      this.filterSet.delete(field);
    } else {
      // Move between rows/columns/free
      if (fromZone === 'rows') this.rows = this.rows.filter(f => f !== field);
      if (fromZone === 'columns') this.columns = this.columns.filter(f => f !== field);
      if (toZone === 'rows') this.rows.push(field);
      if (toZone === 'columns') this.columns.push(field);
      this.state[field] = toZone;
    }
    this._lastMoved = field;
    this._render();
    this.onChange({ rows: [...this.rows], columns: [...this.columns], filters: [...this.filterSet] });
  }

  _moveFieldBefore(field, fromZone, toZone, beforeField) {
    if (toZone === 'filters') {
      this.filterSet.add(field);
      this._lastMoved = field;
      this._render();
      this.onChange({ rows: [...this.rows], columns: [...this.columns], filters: [...this.filterSet] });
      return;
    }

    if (fromZone === 'filters') {
      // Dragged from filters to rows/columns — add there, keep in filters
      const arr = toZone === 'rows' ? this.rows : toZone === 'columns' ? this.columns : null;
      if (arr && !arr.includes(field)) {
        if (beforeField) {
          const idx = arr.indexOf(beforeField);
          arr.splice(idx !== -1 ? idx : arr.length, 0, field);
        } else {
          arr.push(field);
        }
        this.state[field] = toZone;
      }
    } else {
      if (fromZone === 'rows') this.rows = this.rows.filter(f => f !== field);
      if (fromZone === 'columns') this.columns = this.columns.filter(f => f !== field);
      const arr = toZone === 'rows' ? this.rows : toZone === 'columns' ? this.columns : null;
      if (arr) {
        if (beforeField) {
          const idx = arr.indexOf(beforeField);
          arr.splice(idx !== -1 ? idx : arr.length, 0, field);
        } else {
          arr.push(field);
        }
      }
      this.state[field] = toZone;
    }

    this._lastMoved = field;
    this._render();
    this.onChange({ rows: [...this.rows], columns: [...this.columns], filters: [...this.filterSet] });
  }

  _reorder(field, zone, beforeField) {
    const arr  = zone === 'rows' ? this.rows : this.columns;
    const from = arr.indexOf(field);
    if (from === -1) return;

    arr.splice(from, 1);

    if (beforeField) {
      const to = arr.indexOf(beforeField);
      arr.splice(to !== -1 ? to : arr.length, 0, field);
    } else {
      arr.push(field); // placeholder was at the end — append to end
    }
    this._lastMoved = field;
    this._render();
    // this.onChange({ rows: [...this.rows], columns: [...this.columns], filters: [...this.filters] });
    this.onChange({ rows: [...this.rows], columns: [...this.columns], filters: [...this.filterSet] });
  }
}
