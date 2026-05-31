/**
 * Кодирует строковые значения одной колонки в uint16-индексы.
 * Используется внутри ColumnStore — один экземпляр на измерение.
 */
class DictionaryEncoder {
  constructor() {
    this._map     = new Map();  // строка → индекс
    this._reverse = [];         // индекс → строка
  }

  /** Возвращает числовой индекс для значения, создавая при необходимости */
  encode(value) {
    const str = String(value);
    if (!this._map.has(str)) {
      const idx = this._reverse.length;
      this._map.set(str, idx);
      this._reverse.push(str);
    }
    return this._map.get(str);
  }

  /** Восстанавливает строку по индексу */
  decode(index) {
    return this._reverse[index];
  }

  get size() {
    return this._reverse.length;
  }
}