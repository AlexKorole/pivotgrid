/**
 * Columnar row storage backed by TypedArrays.
 * Dimensions → Uint16Array (via DictionaryEncoder),
 * measures   → Float64Array.
 * ~10× memory savings compared to an array of objects.
 */
class ColumnStore {
  constructor({ dimensions, measures, funcs, capacity }) {
    this.dimensions = dimensions;
    this.capacity   = capacity;
    this.length     = 0;

    // Expand each measure into the physical base columns its funcs need —
    // sum/count/min/max are stored directly; avg/variance/stddev are
    // algebraic, so we store their ingredients (sum, count, sum_sq) instead
    // and derive the displayed value on read, so it stays correct when a
    // cached n-dimension GROUP BY is collapsed to n-a dimensions.
    const baseColsFor = {
      sum:      m => [`${m}_sum`],
      count:    m => [`${m}_count`],
      min:      m => [`${m}_min`],
      max:      m => [`${m}_max`],
      avg:      m => [`${m}_sum`, `${m}_count`],
      variance: m => [`${m}_sum`, `${m}_sum_sq`, `${m}_count`],
      stddev:   m => [`${m}_sum`, `${m}_sum_sq`, `${m}_count`],
    };

    const expandedMeasures = [...new Set(
      measures.flatMap(m => funcs.flatMap(fn => (baseColsFor[fn] || (() => []))(m)))
    )];
    this.measures = expandedMeasures;  // overwrite

    // One encoder per dimension
    this.encoders = {};
    for (const dim of dimensions) {
      this.encoders[dim] = new DictionaryEncoder();
    }

    // Columns: Uint16 for dimensions, Float64 for measures
    this.dimCols  = {};
    this.measCols = {};
    for (const dim of dimensions)       this.dimCols[dim]  = new Uint16Array(capacity);
    for (const m   of expandedMeasures) this.measCols[m]   = new Float64Array(capacity);
  }

  /** Returns true if no more rows can be added */
  isFull() {
    return this.length >= this.capacity;
  }

  /**
   * Appends rows to the store.
   * Rows beyond capacity are silently discarded.
   * @param {Object[]} rows
   * @returns {number} number of rows actually added
   */
  append(rows) {
    const room  = this.capacity - this.length;
    const batch = rows.length > room ? rows.slice(0, room) : rows;

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const idx = this.length + i;
      for (const dim of this.dimensions) {
        this.dimCols[dim][idx] = this.encoders[dim].encode(row[dim]);
      }
      for (const m of this.measures) {
        this.measCols[m][idx] = Number(row[m]) || 0;
      }
    }

    this.length += batch.length;
    return batch.length;
  }

  /**
   * Returns an iterable view of rows without materialising
   * the full object array — Aggregator traverses data on-the-fly.
   * Supports for…of, .forEach and .length.
   */
  rows() {
    const { dimensions, measures, dimCols, measCols, encoders, length } = this;

    const iterable = {
      length,

      forEach(fn) {
        for (let i = 0; i < length; i++) {
          const row = {};
          for (const dim of dimensions) row[dim] = encoders[dim].decode(dimCols[dim][i]);
          for (const m   of measures)   row[m]   = measCols[m][i];
          fn(row, i);
        }
      },

      [Symbol.iterator]() {
        let i = 0;
        return {
          next() {
            if (i >= length) return { done: true, value: undefined };
            const row = {};
            for (const dim of dimensions) row[dim] = encoders[dim].decode(dimCols[dim][i]);
            for (const m   of measures)   row[m]   = measCols[m][i];
            i++;
            return { done: false, value: row };
          }
        };
      }
    };

    return iterable;
  }
}