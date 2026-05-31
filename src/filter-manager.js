/**
 * FilterManager
 *
 * Manages filters per dimension:
 *   - If values ≤ filterCheckboxLimit → checkboxes + search
 *   - If more → text search only (contains / starts_with)
 *   - Values are fetched from the provider cache or from the server
 */
class FilterManager {

  constructor({ provider, fields, config }) {
    this.provider = provider;
    this.fields   = fields;
    this.config   = config;

    // dim → { allValues, selected, searchType, searchText }
    this._state  = {};
    this._popup  = null;
    this._openDim = null;
    this._onChange = null;
  }

  set onChange(fn) { this._onChange = fn; }

  // ── Dimension management ──────────────────────────────────────────────────

  async onDimAdded(dim) {
    if (this._state[dim]) {
      // already exists — just open the popup (FieldZones will call onFilterOpen)
      return;
    }

    this._state[dim] = {
      allValues:  null,
      selected:   null,   // null = all (no checkbox filter)
      searchType: 'contains',
      searchText: '',
    };

    // Load values if checkboxes are needed
    try {
      const limit = this.config.filterCheckboxLimit ?? 30;
      const count = await this.provider.countDistinct(dim);
      if (count <= limit) {
        this._state[dim].allValues = await this.provider.getDistinctValues(dim);
      }
    } catch (e) {
      console.warn('FilterManager: failed to load values for', dim, e);
    }
  }

  onDimRemoved(dim) {
    delete this._state[dim];
    if (this._openDim === dim) this._closePopup();
    this._notify();
  }

  // ── Popup ────────────────────────────────────────────────────────────────

  openFor(dim, anchorEl) {
    this._closePopup();
    const f = this._state[dim];
    if (!f) return;

    this._openDim = dim;

    const popup = document.createElement('div');
    popup.className = 'fm-popup';
    document.body.appendChild(popup);
    this._popup = popup;

    this._renderPopup(popup, dim, f);
    this._positionPopup(popup, anchorEl);

    requestAnimationFrame(() => {
      document.addEventListener('mousedown', this._handleOutside = (e) => {
        if (!popup.contains(e.target) && !anchorEl.contains(e.target)) {
          this._closePopup();
        }
      });
    });
  }

  _renderPopup(popup, dim, f) {
    const radioName = 'fm-stype-' + dim;
    const checkboxesHTML = f.allValues
      ? `<div class="fm-checkbox-list">
          <label class="fm-checkbox fm-select-all-wrap">
            <input type="checkbox" class="fm-select-all" ${!f.selected ? 'checked' : ''}>
            <em>All values</em>
          </label>
          <div class="fm-checkbox-scroll">
            ${f.allValues.map(v => `
              <label class="fm-checkbox">
                <input type="checkbox" value="${v.replace(/"/g, '&quot;')}"
                  ${!f.selected || f.selected.has(v) ? 'checked' : ''}>
                <span>${v}</span>
              </label>
            `).join('')}
          </div>
        </div>`
      : `<p class="fm-no-checkboxes">Too many values — use search</p>`;

    popup.innerHTML = `
      <div class="fm-popup-header">
        <span class="fm-popup-title">${dim}</span>
        <button class="fm-popup-close">×</button>
      </div>
      <div class="fm-search-section">
        <div class="fm-search-type">
          <label><input type="radio" name="${radioName}" value="contains"
            ${f.searchType === 'contains' ? 'checked' : ''}> Contains</label>
          <label><input type="radio" name="${radioName}" value="starts_with"
            ${f.searchType === 'starts_with' ? 'checked' : ''}> Starts with</label>
        </div>
        <input type="text" class="fm-search-input" placeholder="Search..." value="${f.searchText}">
      </div>
      ${checkboxesHTML}
      <div class="fm-popup-footer">
        <button class="fm-btn fm-btn-clear">Clear</button>
        <button class="fm-btn fm-btn-primary">Apply</button>
      </div>
    `;

    const searchInput = popup.querySelector('.fm-search-input');
    const selectAll   = popup.querySelector('.fm-select-all');

    popup.querySelector('.fm-popup-close').onclick = () => this._closePopup();

    // Sync the "Select all" checkbox state based on visible rows
    const syncSelectAll = () => {
      if (!selectAll) return;
      const visible      = [...popup.querySelectorAll('.fm-checkbox:not(.fm-select-all-wrap)')]
        .filter(l => l.style.display !== 'none');
      const checkedCount = visible.filter(l => l.querySelector('input').checked).length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < visible.length;
      selectAll.checked       = visible.length > 0 && checkedCount === visible.length;
    };

    // Search: hides non-matching rows and unchecks them.
    // Important: hidden items must not silently end up in the selection on Apply.
    const applyCheckboxSearch = () => {
      const q    = searchInput?.value.trim().toLowerCase() || '';
      const type = popup.querySelector(`input[name="${radioName}"]:checked`)?.value || 'contains';

      popup.querySelectorAll('.fm-checkbox:not(.fm-select-all-wrap)').forEach(label => {
        const text = label.querySelector('span')?.textContent.trim().toLowerCase() || '';
        const ok   = !q || (type === 'starts_with' ? text.startsWith(q) : text.includes(q));

        label.style.display = ok ? '' : 'none';

        // Uncheck hidden items — if the user clears the search text later,
        // these items will reappear unchecked, not "selected by default"
        if (!ok) label.querySelector('input').checked = false;
      });

      syncSelectAll();
    };

    // Search type — apply to checkboxes immediately
    popup.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
      r.onchange = () => {
        f.searchType = r.value;
        applyCheckboxSearch();
      };
    });

    // Text search
    searchInput?.addEventListener('input', applyCheckboxSearch);

    // "Select all" / "Deselect all" — affects ALL checkboxes, including hidden ones.
    // Otherwise unchecking "All values" with active search would not reset hidden items.
    selectAll?.addEventListener('change', () => {
      popup.querySelectorAll('.fm-checkbox:not(.fm-select-all-wrap) input')
        .forEach(cb => { cb.checked = selectAll.checked; });
    });

    // Clear
    popup.querySelector('.fm-btn-clear').onclick = () => {
      f.selected   = null;
      f.searchText = '';
      this._closePopup();
      this._notify();
    };

    // Apply
    popup.querySelector('.fm-btn-primary').onclick = () => {
      const checkedRadio = popup.querySelector(`input[name="${radioName}"]:checked`);
      f.searchType = checkedRadio ? checkedRadio.value : 'contains';
      f.searchText = searchInput?.value.trim() || '';

      if (f.allValues) {
        const checkedBoxes = [...popup.querySelectorAll('.fm-checkbox:not(.fm-select-all-wrap) input:checked')]
          .map(cb => cb.value);
        f.selected = checkedBoxes.length === f.allValues.length ? null : new Set(checkedBoxes);
      }

      this._closePopup();
      this._notify();
    };

    // Apply current filter immediately on popup open —
    // so checkboxes immediately reflect the saved searchText / searchType
    if (f.searchText) applyCheckboxSearch();
  }

  _positionPopup(popup, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 290);
    popup.style.left = left + 'px';
    popup.style.top  = (rect.bottom + 6) + 'px';
  }

  _closePopup() {
    this._popup?.remove();
    this._popup   = null;
    this._openDim = null;
    if (this._handleOutside) {
      document.removeEventListener('mousedown', this._handleOutside);
      this._handleOutside = null;
    }
  }

  // ── Active filters ────────────────────────────────────────────────────────

  /**
   * Returns active filters in the format expected by the provider.
   * { dim: { values: string[]|null, searchType, searchText } }
   */
  getActiveFilters() {
    const result = {};
    for (const [dim, f] of Object.entries(this._state)) {
      const hasSelected = f.selected && f.selected.size > 0;
      const hasSearch   = f.searchText.length > 0;
      if (hasSelected || hasSearch) {
        result[dim] = {
          values:     hasSelected ? [...f.selected] : null,
          searchType: f.searchType,
          searchText: f.searchText,
        };
      }
    }
    return result;
  }

  hasActiveFilter(dim) {
    const f = this._state[dim];
    if (!f) return false;
    return (f.selected && f.selected.size > 0) || f.searchText.length > 0;
  }

  getFilterHints() {
    const result = {};
    for (const [dim, f] of Object.entries(this._state)) {
      const parts = [];

      if (f.searchText) {
        const prefix = f.searchType === 'starts_with' ? '' : '…';
        parts.push(`«${f.searchText}${prefix}»`);
      }

      if (f.selected && f.selected.size > 0) {
        const total = f.allValues?.length ?? null;
        // If few items are excluded — show "except"
        if (total && total - f.selected.size <= 2) {
          const excluded = f.allValues.filter(v => !f.selected.has(v));
          parts.push(`except: ${excluded.join(', ')}`);
        } else if (f.selected.size <= 3) {
          parts.push([...f.selected].join(', '));
        } else {
          parts.push(`${f.selected.size} val.`);
        }
      }

      if (parts.length) {
        result[dim] = {
          badge: parts.length === 1 && f.selected?.size
            ? String(f.selected.size)   // just a number on the chip
            : '✕',
          tooltip: parts.join(' + '),
        };
      }
    }
    return result;
  }

  _notify() {
    this._onChange?.();
  }
}
