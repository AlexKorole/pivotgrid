/**
 * cache-manager.js
 *
 * Manages the dimension cache UI:
 * - Renders dimension chips with cached/uncached state
 * - Shows a fill meter and status label
 * - Validates row count before adding a dimension to cache
 * - Triggers cache refresh via the provider
 */
class CacheManager {

  /**
   * @param {object}   options
   * @param {object}   options.provider       — data provider (RestProvider or ArrayProvider)
   * @param {string[]} options.dimensions      — full list of dimensions
   * @param {number}   options.maxCachedRows   — row limit for the cache
   * @param {number}   options.initialCount    — current row count in cache
   * @param {Function} options.onRefresh       — callback after cache refresh
   * @param {string}   [options.lang='ru']     — UI language
   */
  constructor({ provider, dimensions, maxCachedRows, initialCount, onRefresh, lang = 'ru' }) {
    this._provider   = provider;
    this._dims       = dimensions;
    this._maxRows    = maxCachedRows;
    this._cached     = new Set(provider.cachedDimensions);
    this._count      = initialCount;
    this._stale      = false;
    this._checking   = false;
    this._toastTimer = null;
    this._onRefresh  = onRefresh;
    this._t          = (key, vars = {}) => {
      let str = (I18N[lang] || I18N.ru)[key] || key;
      for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
      return str;
    };

    this._render();
    this._bindRefresh();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /** Renders all UI parts: chips, meter, status. */
  _render() {
    this._renderChips();
    this._renderMeter();
    this._renderStatus();
  }

  /** Renders dimension chips with cached/uncached state. */
  _renderChips() {
    const body = document.getElementById('cache-chips');
    body.innerHTML = '';

    for (const dim of this._dims) {
      const chip = document.createElement('div');
      chip.className   = 'cache-chip' + (this._cached.has(dim) ? ' is-cached' : '');
      chip.dataset.dim = dim;
      const def = CONFIG.fields[dim] || {};
      chip.textContent = def.title || def.label || dim;
      chip.title = this._cached.has(dim)
        ? this._t('cacheRemove')
        : this._t('cacheAdd');
      chip.addEventListener('click', () => this._toggle(dim));
      body.appendChild(chip);
    }
  }

  /** Returns the chip element for a given dimension. */
  _chip(dim) {
    return document.querySelector(`.cache-chip[data-dim="${dim}"]`);
  }

  /** Updates the fill meter bar and label. */
  _renderMeter() {
    const fill  = document.getElementById('cache-meter-fill');
    const label = document.getElementById('cache-meter-label');
    const pct   = this._cached.size > 0
      ? Math.min(this._count / this._maxRows * 100, 100)
      : 0;
    const cls   = pct < 60 ? 'ok' : pct < 85 ? 'warn' : 'danger';

    fill.style.width = pct.toFixed(1) + '%';
    fill.className   = `cache-meter-fill ${cls}`;

    if (this._cached.size === 0) {
      label.textContent = '—';
      label.className   = 'cache-meter-label';
    } else {
      label.textContent = `~${this._count.toLocaleString()} / ${this._maxRows.toLocaleString()}`;
      label.className   = `cache-meter-label ${cls}`;
    }
  }

  /** Updates the cache status label and refresh button state. */
  _renderStatus() {
    const status = document.getElementById('cache-status');
    const btn    = document.getElementById('btn-refresh-cache');

    if (this._stale) {
      status.textContent = this._t('cacheStale');
      status.className   = 'cache-status stale';
      btn.disabled       = false;
      btn.classList.add('cache-refresh-btn--stale');
    } else if (this._cached.size === 0) {
      status.textContent = this._t('cacheEmpty');
      status.className   = 'cache-status empty';
      btn.disabled       = true;
      btn.classList.remove('cache-refresh-btn--stale');
    } else {
      status.textContent = this._t('cacheActual');
      status.className   = 'cache-status fresh';
      btn.disabled       = true;
      btn.classList.remove('cache-refresh-btn--stale');
    }
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  /**
   * Toggles a dimension in/out of the cache set.
   * When adding, runs a COUNT query to validate the row limit first.
   * @param {string} dim — logical dimension name
   */
  async _toggle(dim) {
    if (this._checking) return;

    const chip = this._chip(dim);
    if (!chip) return;

    if (this._cached.has(dim)) {
      this._cached.delete(dim);
      chip.className = 'cache-chip';
      chip.title     = this._t('cacheAdd');
      this._stale    = true;
      this._renderStatus();
      this._refreshCountAsync();
      return;
    }

    this._checking = true;
    chip.className = 'cache-chip is-checking';

    try {
      const trial = [...this._cached, dim];
      const count = await this._provider.countRows(trial);

      if (count > this._maxRows) {
        chip.className = 'cache-chip is-rejected';
        this._showToast(
          `«${dim}»: ~${count.toLocaleString()} — ${this._t('cacheExceeds')} ${this._maxRows.toLocaleString()}`
        );
        setTimeout(() => {
          chip.className = 'cache-chip';
          chip.title     = this._t('cacheAdd');
        }, 700);
      } else {
        this._cached.add(dim);
        this._count    = count;
        this._stale    = true;
        chip.className = 'cache-chip is-cached';
        chip.title     = this._t('cacheRemove');
      }
    } catch (err) {
      chip.className = 'cache-chip';
      this._showToast(this._t('errorPrefix') + (err.message || err));
    } finally {
      this._checking = false;
      this._renderMeter();
      this._renderStatus();
    }
  }

  /**
   * Refreshes the row count for the current cached dimensions asynchronously.
   * Used after removing a dimension from cache.
   */
  async _refreshCountAsync() {
    if (this._cached.size === 0) {
      this._count = 0;
      this._renderMeter();
      return;
    }
    try {
      this._count = await this._provider.countRows([...this._cached]);
    } catch {
      this._count = 0;
    }
    this._renderMeter();
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  /** Binds the "Refresh cache" button click handler. */
  _bindRefresh() {
    const btn  = document.getElementById('btn-refresh-cache');
    const zone = document.querySelector('.cache-zone');

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      zone.classList.add('cache-zone--loading');
      this._showFullscreenLoader(true);

      try {
        await this._provider.refreshCache([...this._cached]);
        this._count = this._provider.cacheRows;
        this._stale = false;
        this._renderChips();
        this._renderMeter();
        this._renderStatus();
        await this._onRefresh?.();
      } catch (err) {
        this._showToast(this._t('cacheRefreshError') + (err.message || err));
      } finally {
        this._showFullscreenLoader(false);
        zone.classList.remove('cache-zone--loading');
        this._renderStatus();
      }
    });
  }

  // ── Toast / Loader ────────────────────────────────────────────────────────

  /**
   * Shows or hides the fullscreen loading overlay.
   * @param {boolean} on
   */
  _showFullscreenLoader(on) {
    let el = document.getElementById('cache-fullscreen-loader');
    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id          = 'cache-fullscreen-loader';
        el.textContent = this._t('loading');
        document.body.appendChild(el);
      }
    } else {
      el?.remove();
    }
  }

  /**
   * Shows a brief toast notification at the bottom of the screen.
   * @param {string} msg — message to display
   */
  _showToast(msg) {
    const toast = document.getElementById('cache-toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }
}
