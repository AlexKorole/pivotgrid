/**
 * demo-config.js
 * Config for demo mode (no server).
 */
const DEMO_CONFIG = {
  dimensions: ['region', 'category', 'product', 'manager', 'channel',
               'sale_year', 'sale_quarter', 'sale_month', 'sale_week',
               'sale_hour', 'sale_minute'],
  measures:   ['revenue', 'units'],
  funcs:      ['sum', 'avg', 'count', 'min', 'max'],

  fields: {
    region:       { label: 'region',          title: 'Регион' },
    category:     { label: 'category',         title: 'Категория' },
    product:      { label: 'product',           title: 'Продукт' },
    manager:      { label: 'manager',           title: 'Менеджер' },
    channel:      { label: 'channel',           title: 'Канал' },
    sale_year:    { label: 'sale_year',         title: 'Год' },
    sale_quarter: { label: 'sale_quarter',      title: 'Квартал' },
    sale_month:   { label: 'sale_month_name',   title: 'Месяц', sortKey: 'sale_month_num' },
    sale_week:    { label: 'sale_week',         title: 'Неделя' },
    sale_hour:    { label: 'sale_hour',         title: 'Час' },
    sale_minute:  { label: 'sale_minute',       title: 'Минута' },
    revenue:      { label: 'revenue',           title: 'Выручка' },
    units:        { label: 'units',             title: 'Единицы' },
  },

  cachedDimensions: ['region', 'category'],

  rows:    ['region'],
  columns: [],
  measure: 'revenue',
  func:    'sum',

  maxCachedRows:       500_000,
  filterCheckboxLimit: 5,
  drillthroughQuery: 'demo',
};
