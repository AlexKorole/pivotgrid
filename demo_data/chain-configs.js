/**
 * chain-configs.js
 *
 * Demo-mode equivalents of base_chain_config.json / child_chain_config.json —
 * same dimensions/fields/rows/columns, just without `query` (ArrayProvider
 * works directly off DEMO_DATA, no SQL involved).
 *
 * Usage: <div data-demo="base"  ...> / <div data-demo="child" data-listen="..." ...>
 */
window.DEMO_CONFIGS = {

  base: {
    dimensions: ['region', 'category', 'channel', 'sale_year', 'sale_quarter', 'sale_month_name'],
    measures: ['revenue', 'units'],
    funcs: ['sum', 'avg', 'count'],
    fields: {
      region:           { label: 'region',           title: 'Region' },
      category:         { label: 'category',         title: 'Category' },
      channel:          { label: 'channel',           title: 'Channel' },
      revenue:          { label: 'revenue',           title: 'Revenue' },
      units:            { label: 'units',             title: 'Units' },
      sale_year:        { label: 'sale_year',         title: 'Year' },
      sale_quarter:     { label: 'sale_quarter',       title: 'Quarter' },
      sale_month_name:  { label: 'sale_month_name',   title: 'Month', sortKey: 'sale_month_num' },
    },
    cachedDimensions: ['sale_year', 'sale_month_name', 'sale_quarter', 'region', 'channel', 'category'],
    rows: ['region', 'channel', 'category'],
    columns: ['sale_year', 'sale_quarter', 'sale_month_name'],
    measure: 'revenue',
    func: 'sum',
    maxCachedRows: 1_000_000,
    filterCheckboxLimit: 30,
  },

  child: {
    dimensions: ['product', 'manager', 'sale_week', 'sale_day_num', 'sale_weekday_name', 'sale_hour', 'sale_minute'],
    measures: ['revenue', 'units'],
    funcs: ['sum', 'avg', 'count'],
    fields: {
      product:            { label: 'product',            title: 'Product' },
      manager:            { label: 'manager',             title: 'Manager' },
      revenue:            { label: 'revenue',             title: 'Revenue' },
      units:              { label: 'units',               title: 'Units' },
      sale_week:          { label: 'sale_week',           title: 'Week' },
      sale_day_num:       { label: 'sale_day_num',        title: 'Day' },
      sale_weekday_name:  { label: 'sale_weekday_name',   title: 'Weekday', sortKey: 'sale_weekday_num' },
      sale_hour:          { label: 'sale_hour',           title: 'Hour' },
      sale_minute:        { label: 'sale_minute',         title: 'Minute' },
    },
    cachedDimensions: [],
    rows: ['manager', 'product'],
    columns: ['sale_day_num', 'sale_weekday_name', 'sale_hour', 'sale_minute'],
    measure: 'revenue',
    func: 'sum',
    maxCachedRows: 1_000_000,
    filterCheckboxLimit: 30,
  },

};
