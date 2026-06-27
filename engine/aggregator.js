/**
 * Aggregator
 *
 * Builds the pivot structure from aggRows.
 * Supports fieldDefs for correct sorting of dates and lookup fields.
 *
 * Usage:
 *   const agg = new Aggregator();
 *
 *   const result = agg.build({
 *     rows:      ['region', 'month'],
 *     columns:   ['channel'],
 *     measure:   'revenue',
 *     func:      'sum',
 *     aggRows,
 *     fieldDefs: {
 *       region: { label: 'region' },
 *       month:  { label: 'month_name', sortKey: 'month_num' },
 *     },
 *   });
 */

// Aggregation plan per function: which raw components to accumulate
// row-by-row (with their own combine + seed), and how to derive the final
// displayed number from those components once all rows are folded in.
// sum/count/min/max are distributive — one component, derive is identity.
// avg/variance/stddev are algebraic — multiple components, computed once
// at the end, so they stay correct even when a cached GROUP BY over n
// dimensions is collapsed down to n-a dimensions on the client.
const AGG_PLANS = {
  sum:      m => ({ components: [{ key: `${m}_sum`,   combine: (a, b) => a + b, seed: 0 }],
                     derive: c => c[0] }),
  count:    m => ({ components: [{ key: `${m}_count`, combine: (a, b) => a + b, seed: 0 }],
                     derive: c => c[0] }),
  min:      m => ({ components: [{ key: `${m}_min`,   combine: Math.min,        seed: Infinity }],
                     derive: c => c[0] }),
  max:      m => ({ components: [{ key: `${m}_max`,   combine: Math.max,        seed: -Infinity }],
                     derive: c => c[0] }),
  avg:      m => ({ components: [
                       { key: `${m}_sum`,   combine: (a, b) => a + b, seed: 0 },
                       { key: `${m}_count`, combine: (a, b) => a + b, seed: 0 },
                     ],
                     derive: c => (c[1] > 0 ? c[0] / c[1] : 0) }),
  variance: m => ({ components: [
                       { key: `${m}_sum`,    combine: (a, b) => a + b, seed: 0 },
                       { key: `${m}_sum_sq`, combine: (a, b) => a + b, seed: 0 },
                       { key: `${m}_count`,  combine: (a, b) => a + b, seed: 0 },
                     ],
                     // Sample variance — matches Postgres VARIANCE()/VAR_SAMP default
                     derive: c => {
                       const [sum, sumSq, n] = c;
                       if (n < 2) return 0;
                       return (sumSq - (sum * sum) / n) / (n - 1);
                     } }),
  stddev:   m => {
                     const v = AGG_PLANS.variance(m);
                     return { components: v.components, derive: c => Math.sqrt(Math.max(v.derive(c), 0)) };
                   },
};

class Aggregator {

  build({ rows, columns, measure, func, aggRows, fieldDefs = {} }) {
    const plan       = (AGG_PLANS[func] || AGG_PLANS.sum)(measure);
    const nComp      = plan.components.length;
    const cells      = new Map();          // key → array of raw components (not a final number yet)
    let grandComp    = plan.components.map(c => c.seed);
    const hasColumns = columns && columns.length > 0;

    // Pre-compute label and sortKey once, outside the loop
    const rowCols  = rows.map(f => (fieldDefs[f] || {}).label || f);
    const rowSorts = rows.map(f => (fieldDefs[f] || {}).sortKey || null);
    const colCols  = hasColumns ? columns.map(f => (fieldDefs[f] || {}).label || f) : [];
    const colSorts = hasColumns ? columns.map(f => (fieldDefs[f] || {}).sortKey || null) : [];

    const rowDepth   = rows.length;
    const colDepth   = colCols.length;
    const rowKeysBuf = new Array(rowDepth);
    const colKeysBuf = new Array(colDepth);

    // Build tree roots inline — no extra passes over aggRows needed
    const rowRoot = new Map();
    const colRoot = new Map();

    for (const row of aggRows) {
      const compVals = plan.components.map(c => Number(row[c.key]) || 0);
      for (let i = 0; i < nComp; i++) {
        grandComp[i] = plan.components[i].combine(grandComp[i], compVals[i]);
      }

      // Row keys + row tree in a single pass
      let rNode = rowRoot;
      for (let d = 0; d < rowDepth; d++) {
        const v       = String(row[rowCols[d]] ?? '');
        const sortVal = rowSorts[d] ? row[rowSorts[d]] : v;
        rowKeysBuf[d] = d === 0 ? v : rowKeysBuf[d - 1] + '→' + v;
        if (!rNode.has(v)) rNode.set(v, { sortKey: sortVal, children: new Map() });
        rNode = rNode.get(v).children;
      }

      // Column keys + column tree in a single pass
      if (hasColumns) {
        let cNode = colRoot;
        for (let d = 0; d < colDepth; d++) {
          const v       = String(row[colCols[d]] ?? '');
          const sortVal = colSorts[d] ? row[colSorts[d]] : v;
          colKeysBuf[d] = d === 0 ? v : colKeysBuf[d - 1] + '→' + v;
          if (!cNode.has(v)) cNode.set(v, { sortKey: sortVal, children: new Map() });
          cNode = cNode.get(v).children;
        }
      }

      // Accumulate cell values — per function-specific component(s)
      for (let d = 0; d < rowDepth; d++) {
        const rk = rowKeysBuf[d];
        if (hasColumns) {
          for (let cd = 0; cd < colDepth; cd++) {
            this._accumulate(cells, rk + '||' + colKeysBuf[cd], compVals, plan);
          }
        }
        this._accumulate(cells, rk + '||__total__', compVals, plan);
      }

      if (hasColumns) {
        for (let cd = 0; cd < colDepth; cd++) {
          this._accumulate(cells, '__grand__||' + colKeysBuf[cd], compVals, plan);
        }
      }
    }

    // Map trees → node arrays
    const toNodes = (map, depth, parentKey, maxDepth) =>
      [...map.entries()]
        .sort(([, a], [, b]) => {
          const av = a.sortKey, bv = b.sortKey;
          if (av !== bv && !isNaN(Number(av)) && !isNaN(Number(bv))) return Number(av) - Number(bv);
          return String(av).localeCompare(String(bv), 'ru');
        })
        .map(([val, data]) => {
          const code     = parentKey ? parentKey + '→' + val : val;
          const children = depth + 1 < maxDepth
            ? toNodes(data.children, depth + 1, code, maxDepth)
            : null;
          return { value: val, code, depth, children };
        });

    const tree    = toNodes(rowRoot, 0, '', rowDepth);
    const colTree = hasColumns ? toNodes(colRoot, 0, '', colDepth) : null;
    const colKeys = hasColumns ? this._flattenColTree(colTree) : [];

    // Derive the displayed number from raw components — one pass over the
    // (small) set of unique cells, not over aggRows.
    const finalCells = new Map();
    for (const [key, comp] of cells) finalCells.set(key, plan.derive(comp));
    const grandTotal = plan.derive(grandComp);

    return { cells: finalCells, colKeys, colTree, tree, grandTotal };
  }

  /**
   * Accumulates one row's raw components into a cell, seeding it
   * (per-component) on first touch.
   */
  _accumulate(cells, key, compVals, plan) {
    let comp = cells.get(key);
    if (!comp) {
      comp = plan.components.map(c => c.seed);
      cells.set(key, comp);
    }
    for (let i = 0; i < compVals.length; i++) {
      comp[i] = plan.components[i].combine(comp[i], compVals[i]);
    }
  }

  // ── Get the label value for a field from a row ───────────────────────────

  _labelVal(row, field, fieldDefs) {
    const def = fieldDefs[field] || {};
    return String(row[def.label || field] ?? '');
  }

  // ── Tree ─────────────────────────────────────────────────────────────────

  /**
   * Builds the tree in a single pass over aggRows.
   * Groups by label, sorts by sortKey (if present).
   */
  _buildTree(aggRows, levels, fieldDefs = {}) {
    if (!levels.length) return null;

    // Map<labelValue, { sortKey: value, children: Map }>
    const root = new Map();

    for (const row of aggRows) {
      let node = root;
      for (let d = 0; d < levels.length; d++) {
        const field    = levels[d];
        const def      = fieldDefs[field] || {};
        const labelCol = def.label   || field;
        const sortCol  = def.sortKey || null;
        const labelVal = String(row[labelCol] ?? '');
        const sortVal  = sortCol ? row[sortCol] : labelVal;

        if (!node.has(labelVal)) {
          node.set(labelVal, { sortKey: sortVal, children: new Map() });
        }
        node = node.get(labelVal).children;
      }
    }

    // Recursively convert Map → node tree
    const toNodes = (map, depth, parentKey) => {
      return [...map.entries()]
        .sort(([, aData], [, bData]) => {
          const a = aData.sortKey;
          const b = bData.sortKey;
          // Numeric sort if both values are numbers
          if (a !== b && !isNaN(Number(a)) && !isNaN(Number(b))) {
            return Number(a) - Number(b);
          }
          return String(a).localeCompare(String(b), 'ru');
        })
        .map(([val, data]) => {
          const code     = parentKey ? parentKey + '→' + val : val;
          const children = depth + 1 < levels.length
            ? toNodes(data.children, depth + 1, code)
            : null;
          return { value: val, code, depth, children };
        });
    };

    return toNodes(root, 0, '');
  }

  // Flat list of all column tree nodes
  _flattenColTree(nodes) {
    const result = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        result.push({
          code:        node.code,
          label:       node.value,
          depth:       node.depth,
          hasChildren: !!node.children,
        });
        if (node.children) walk(node.children);
      }
    };
    walk(nodes);
    return result;
  }
}
