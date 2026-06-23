/**
 * demo-config.js
 * Config for demo mode (no server).
 */
const DEMO_CONFIG = {
  dimensions: ['region', 'category', 'product', 'manager', 'channel',
               'sale_year', 'sale_quarter', 'sale_month', 'sale_day_num', 'sale_weekday_name', 
               'sale_hour', 'sale_minute'],
  measures:   ['revenue', 'units'],
  funcs:      ['sum', 'avg', 'count', 'min', 'max'],

  fields: {
    region:       { label: 'region',          title: 'Region' },
    category:     { label: 'category',         title: 'Category' },
    product:      { label: 'product',           title: 'Product' },
    manager:      { label: 'manager',           title: 'Manager' },
    channel:      { label: 'channel',           title: 'Channel' },
    sale_year:    { label: 'sale_year',         title: 'Year' },
    sale_quarter: { label: 'sale_quarter',      title: 'Quarter' },
    sale_month:   { label: 'sale_month_name', title: 'Month', sortKey: 'sale_month_num' },
    sale_weekday_name:    { label: 'sale_weekday_name', title: 'Weekday', sortKey: 'sale_weekday_num' },
    sale_day_num:    { label: 'sale_day_num',         title: 'Day'},
    sale_hour:    { label: 'sale_hour',         title: 'Hour' },
    sale_minute:  { label: 'sale_minute',       title: 'Minute' },
    revenue:      { label: 'revenue',           title: 'Revenue' },
    units:        { label: 'units',             title: 'Units' },
  },

  cachedDimensions: ['region', 'category'],

  rows:    ['region', 'channel'],
  columns: ['sale_year', 'sale_month_name'],
  measure: 'revenue',
  func:    'sum',

  maxCachedRows:       500_000,
  filterCheckboxLimit: 30,
  drillthroughQuery: 'demo',
};
