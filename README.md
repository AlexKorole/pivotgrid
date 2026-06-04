# PivotGrid JS

Vanilla JS pivot table — no dependencies, no frameworks.

- **Fast** — virtual scroll, columnar storage on TypedArrays, in-memory cache
- **Flexible** — drag-and-drop dimensions, filters, hierarchical rows and columns
- **Simple** — one `<div>` and two attributes, nothing else needed

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

## Server

A lightweight Python proxy to your database is included:

```bash
pip install psycopg2-binary
python node_modules/pivotgrid-js/server/server.py
```

## Config Editor

A visual config editor is included. Open it in your browser:

```
node_modules/pivotgrid-js/config/config-editor.html
```

The editor connects directly to your local server and saves configs there.

## Using with a Bundler

```js
import { PivotGrid, Aggregator, RestProvider, ArrayProvider } from 'pivotgrid-js';
```

Available exports: `PivotGrid`, `Aggregator`, `ColumnStore`, `DictionaryEncoder`,
`RestProvider`, `ArrayProvider`, `FieldZones`, `FilterManager`, `CacheManager`, `I18N`.

## Grid API

```js
grid.expandAll()
grid.collapseAll()
grid.expandToDepth(depth)
grid.expandAllCols()
grid.collapseAllCols()
grid.toggleSubtotals(visible)
grid.setResult(result, { rows, columns, measure, fieldDefs })
```

## Drillthrough

```js
container.addEventListener('drillthrough', (e) => {
  const { context, value } = e.detail;
  // context = { region: 'North', channel: 'Online' }
  // value   = aggregated cell value
});
```

## Internationalization

`ru` and `en` are supported out of the box:

```html
<div data-config="sales" data-lang="en"></div>
```

## License

Free for personal and non-commercial use.  
For commercial use, a license is required — contact [korolevalexa@gmail.com](mailto:korolevalexa@gmail.com).
