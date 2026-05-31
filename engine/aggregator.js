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

class Aggregator {

  build({ rows, columns, measure, func, aggRows, fieldDefs = {} }) {
    const measureKey = `${measure}_${func}`;
    const cells      = new Map();
    let grandTotal   = 0;
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
      const val = Number(row[measureKey]) || 0;
      grandTotal += val;

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

      // Accumulate cell values
      for (let d = 0; d < rowDepth; d++) {
        const rk = rowKeysBuf[d];
        if (hasColumns) {
          for (let cd = 0; cd < colDepth; cd++) {
            const key = rk + '||' + colKeysBuf[cd];
            cells.set(key, (cells.get(key) || 0) + val);
          }
        }
        const totalKey = rk + '||__total__';
        cells.set(totalKey, (cells.get(totalKey) || 0) + val);
      }

      if (hasColumns) {
        for (let cd = 0; cd < colDepth; cd++) {
          const gtKey = '__grand__||' + colKeysBuf[cd];
          cells.set(gtKey, (cells.get(gtKey) || 0) + val);
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

    return { cells, colKeys, colTree, tree, grandTotal };
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
