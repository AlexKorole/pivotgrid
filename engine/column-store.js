/**
 * Columnar-хранилище строк на TypedArrays.
 * Измерения → Uint16Array (через DictionaryEncoder),
 * меры      → Float64Array.
 * Экономия памяти ~10× по сравнению с массивом объектов.
 */
class ColumnStore {
  constructor({ dimensions, measures, funcs, capacity }) {
    this.dimensions = dimensions;
    this.capacity   = capacity;
    this.length     = 0;

    // Разворачиваем revenue → revenue_sum, revenue_avg...
    const expandedMeasures = measures.flatMap(m =>
      funcs.map(fn => `${m}_${fn}`)
    );
    this.measures = expandedMeasures;  // перезаписываем

    // Один энкодер на измерение
    this.encoders = {};
    for (const dim of dimensions) {
      this.encoders[dim] = new DictionaryEncoder();
    }

    // Колонки: Uint16 для измерений, Float64 для мер
    this.dimCols  = {};
    this.measCols = {};
    for (const dim of dimensions)       this.dimCols[dim]  = new Uint16Array(capacity);
    for (const m   of expandedMeasures) this.measCols[m]   = new Float64Array(capacity);
  }

  /** Возвращает true, если добавить больше нельзя */
  isFull() {
    return this.length >= this.capacity;
  }

  /**
   * Добавляет строки в хранилище.
   * Если достигнут capacity — лишние строки молча отбрасываются.
   * @param {Object[]} rows
   * @returns {number} сколько строк реально добавлено
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
   * Возвращает итерируемое представление строк без материализации
   * всего массива объектов — Aggregator обходит данные on-the-fly.
   * Поддерживает for…of, .forEach и .length.
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