/**
 * Encodes string values of a single column into uint16 indices.
 * Used inside ColumnStore — one instance per dimension.
 */
class DictionaryEncoder {
  constructor() {
    this._map     = new Map();  // string → index
    this._reverse = [];         // index → string
  }

  /** Returns the numeric index for a value, creating it if needed */
  encode(value) {
    const str = String(value);
    if (!this._map.has(str)) {
      const idx = this._reverse.length;
      this._map.set(str, idx);
      this._reverse.push(str);
    }
    return this._map.get(str);
  }

  /** Restores the string value by index */
  decode(index) {
    return this._reverse[index];
  }

  get size() {
    return this._reverse.length;
  }
}