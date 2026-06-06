# PivotGrid JS

Vanilla JS pivot table — no dependencies, no frameworks.

- **Fast** — virtual scroll, columnar storage on TypedArrays, in-memory cache
- **Flexible** — drag-and-drop dimensions, filters, hierarchical rows and columns
- **Simple** — one `<div>` and few attributes, nothing else needed

**[Live Demo](https://windowrepino.ru/pivot/demo/demo-example.html)**

![PivotGrid](https://raw.githubusercontent.com/AlexKorole/pivotgrid/master/assets/screenshot.png)

## Installation

```bash
npm install pivotgrid-js
```

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="node_modules/pivotgrid-js/dist/pivotgrid.css">
</head>
<body>

  <div id="my-pivot"
       data-config="sales"
       data-server="http://localhost:8000"
       data-lang="en">
  </div>

  <script src="node_modules/pivotgrid-js/dist/pivotgrid.js"></script>
  <script src="node_modules/pivotgrid-js/widget/pivot-widget.js"></script>

</body>
</html>
```

## Demo Mode (no server)

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="node_modules/pivotgrid-js/dist/pivotgrid.css">
</head>
<body>
  <div id="my-pivot" data-demo="true" data-lang="en"></div>

  <script src="node_modules/pivotgrid-js/dist/pivotgrid.js"></script>
  <script src="node_modules/pivotgrid-js/demo_data/demo-data.js"></script>
  <script src="node_modules/pivotgrid-js/demo_data/demo-config.js"></script>
  <script src="node_modules/pivotgrid-js/widget/pivot-widget.js"></script>
</body>
</html>
```

## Container Attributes

| Attribute | Description | Example |
|-----------|-------------|---------|
| `data-config` | Config name on the server | `"sales"` |
| `data-server` | Server URL | `"http://localhost:8000"` |
| `data-demo` | Demo mode without a server | `"true"` |
| `data-lang` | Interface language | `"ru"` / `"en"` |
| `data-standalone` | Use an existing HTML structure | `"true"` |

## Config

Configs are stored on the server at `server/configs/{name}.json`:

```json
{
  "query": "SELECT * FROM sales_data",

  "dimensions": ["region", "category", "channel"],
  "measures":   ["revenue", "units"],
  "funcs":      ["sum", "avg", "count", "min", "max"],

  "fields": {
    "region":   { "label": "region",   "title": "Region" },
    "category": { "label": "category", "title": "Category" },
    "channel":  { "label": "channel",  "title": "Channel" },
    "revenue":  { "label": "revenue",  "title": "Revenue" },
    "units":    { "label": "units",    "title": "Units" }
  },

  "cachedDimensions": ["region", "category"],

  "rows":    ["region"],
  "columns": [],
  "measure": "revenue",
  "func":    "sum",

  "maxCachedRows":       500000,
  "filterCheckboxLimit": 5,

  "drillthroughQuery": "SELECT * FROM sales_data WHERE {filters} LIMIT 200"
}
```

### Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `query` | `string` | Base SQL query |
| `dimensions` | `string[]` | List of dimension field names |
| `measures` | `string[]` | List of measure field names |
| `funcs` | `string[]` | Aggregation functions: `sum`, `avg`, `count`, `min`, `max`, `stddev`, `variance` |
| `fields` | `object` | Field definitions — see below |
| `cachedDimensions` | `string[]` | Dimensions to pre-aggregate and cache on startup |
| `rows` | `string[]` | Initial row dimensions |
| `columns` | `string[]` | Initial column dimensions |
| `measure` | `string` | Initial active measure |
| `func` | `string` | Initial aggregation function |
| `maxCachedRows` | `number` | Maximum rows in cache (default: `500000`) |
| `filterCheckboxLimit` | `number` | Max distinct values to show as checkboxes in filter popup (default: `30`) |
| `drillthroughQuery` | `string` | SQL for drillthrough panel. Use `{filters}` as placeholder |
| `drillthroughUrl` | `string` | External URL for drillthrough. Filters are appended as query params |

### Field Definition

Each entry in `fields` can have:

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | Actual column name in the database |
| `title` | `string` | Display name shown in the UI |
| `sortKey` | `string` | Column to sort by instead of the label (useful for month names etc.) |

Example — month sorted by number:
```json
"sale_month": {
  "label": "sale_month_name",
  "title": "Month",
  "sortKey": "sale_month_num"
}
```

## Server

A lightweight Python proxy to your database is included:

```bash
pip install psycopg2-binary
python node_modules/pivotgrid-js/server/server.py
```

See `node_modules/pivotgrid-js/server/README.md` for full server documentation.

## Config Editor

A visual config editor is included. Open it locally:

```
node_modules/pivotgrid-js/config/config-editor.html
```

![Config Editor](https://raw.githubusercontent.com/AlexKorole/pivotgrid/master/assets/config-editor.png)

Features:
- Fetch columns from the database with one click
- Configure dimensions, measures, sortKey
- Drag-and-drop initial state (rows / columns / cache)
- Save config to the server
- Preview changes without saving

## Grid API

```js
// Expand / collapse rows
grid.expandAll()
grid.collapseAll()
grid.expandToDepth(depth)   // e.g. expandToDepth(1) — first level only

// Expand / collapse columns
grid.expandAllCols()
grid.collapseAllCols()

// Subtotals
grid.toggleSubtotals(visible)

// Update data
grid.setResult(result, { rows, columns, measure, fieldDefs })
```

## Drillthrough

Three ways to handle cell clicks:

### 1. Built-in panel (SQL query)

Add `drillthroughQuery` to your config:

```json
"drillthroughQuery": "SELECT * FROM sales_data WHERE {filters} LIMIT 200"
```

A detail panel slides up at the bottom of the page showing the raw rows.

### 2. External URL

Add `drillthroughUrl` to your config:

```json
"drillthroughUrl": "https://myapp.com/details"
```

Opens the URL in a new tab with filters appended as query parameters:
`https://myapp.com/details?region=North&channel=Online`

### 3. Custom handler

Listen for the `drillthrough` event on the container:

```js
document.getElementById('my-pivot').addEventListener('drillthrough', (e) => {
  const { context, value } = e.detail;
  // context = { region: 'North', channel: 'Online' }
  // value   = aggregated cell value
  // your custom logic here
});
```

If neither `drillthroughQuery` nor `drillthroughUrl` is set in the config,
only your custom handler fires.

## Internationalization

`ru` and `en` are supported out of the box:

```html
<div data-config="sales" data-lang="en"></div>
```

To add a language, extend the `I18N` object in `widget/i18n.js`.

## Using with a Bundler

```js
import { PivotGrid, Aggregator, RestProvider, ArrayProvider } from 'pivotgrid-js';
```

Available exports: `PivotGrid`, `Aggregator`, `ColumnStore`, `DictionaryEncoder`,
`RestProvider`, `ArrayProvider`, `FieldZones`, `FilterManager`, `CacheManager`, `I18N`.

## License

Free for personal and non-commercial use.  
For commercial use, a license is required — contact [korolevalexa@gmail.com](mailto:korolevalexa@gmail.com).
