# PivotGrid

Vanilla JS pivot table — no dependencies, no frameworks.

- **Fast** — virtual scroll, columnar storage on TypedArrays, in-memory cache
- **Flexible** — drag-and-drop dimensions, filters, hierarchical rows and columns
- **Simple** — one `<div>` and two attributes, nothing else needed

## Concept

All configuration is done through a config file. The grid API is intentionally minimal:
just create a container with `data-config` and the widget does the rest.

The config is stored on the server and loaded at startup —
no need to change application code to modify the grid structure.

## Quick Start

```html
<!-- Styles -->
<link rel="stylesheet" href="src/pivot.css">
<link rel="stylesheet" href="src/field-zones.css">
<link rel="stylesheet" href="widget/widget.css">

<!-- Engine -->
<script src="engine/dictionary-encoder.js"></script>
<script src="engine/aggregator.js"></script>
<script src="engine/column-store.js"></script>

<!-- Providers -->
<script src="providers/rest-provider.js"></script>
<script src="providers/array-provider.js"></script>

<!-- Component -->
<script src="src/pivot.js"></script>
<script src="src/field-zones.js"></script>
<script src="src/filter-manager.js"></script>

<!-- Widget -->
<script src="widget/i18n.js"></script>
<script src="widget/cache-manager.js"></script>
<script src="widget/pivot-widget.js"></script>

<!-- Grid -->
<div id="my-pivot"
     data-config="sales"
     data-server="http://localhost:8000">
</div>
```

The widget builds the entire UI structure inside the container automatically.

## Demo Without a Server

```html
<!-- Demo data and config -->
<script src="demo/demo-data.js"></script>
<script src="demo/demo-config.js"></script>

<div id="my-pivot" data-demo="true"></div>
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

Configs are stored on the server at `configs/{name}.json`:

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
  "filterCheckboxLimit": 5
}
```

## Server

`server/server.py` — a lightweight Python proxy to the database.

```bash
pip install psycopg2-binary
python server/server.py
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/query` | Execute a SQL query |
| `GET` | `/configs` | List all configs |
| `GET` | `/configs/{name}` | Get a config |
| `POST` | `/configs/{name}` | Save a config |
| `GET` | `/server-config` | DB settings (password excluded) |
| `POST` | `/server-config` | Save DB settings |

### DB Connectors

PostgreSQL is included by default. To add a custom database, create a file in `server/connectors/`:

```python
# server/connectors/mydb.py
NAME = "My Database"

def execute_query(query):
    # your implementation
    return [{"col": "val"}, ...]
```

The server picks up the new connector on next startup.

## Config Editor

A visual config editor — `config/config-editor.html`.

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
grid.expandToDepth(depth)

// Expand / collapse columns
grid.expandAllCols()
grid.collapseAllCols()

// Subtotals
grid.toggleSubtotals(visible)

// Update data
grid.setResult(result, { rows, columns, measure, fieldDefs })
```

## Drillthrough

Clicking a cell dispatches a `drillthrough` event:

```js
container.addEventListener('drillthrough', (e) => {
  const { context, value } = e.detail;
  // context = { region: 'North', channel: 'Online' }
  // value   = aggregated cell value
});
```

Click behaviour is configured in the config:

```json
"drillthroughQuery": "SELECT * FROM sales WHERE {filters} LIMIT 200"
```

or

```json
"drillthroughUrl": "https://myapp.com/details"
```

## Internationalization

```html
<div data-config="sales" data-lang="en"></div>
```

`ru` and `en` are supported. To add a language, extend the `I18N` object in `widget/i18n.js`.

## Project Structure

```
├── src/               # Component
│   ├── pivot.js
│   ├── pivot.css
│   ├── field-zones.js
│   ├── field-zones.css
│   └── filter-manager.js
│
├── engine/            # Aggregation engine
│   ├── aggregator.js
│   ├── column-store.js
│   └── dictionary-encoder.js
│
├── providers/         # Data providers
│   ├── rest-provider.js
│   └── array-provider.js
│
├── widget/            # Widget (UI + init)
│   ├── pivot-widget.js
│   ├── cache-manager.js
│   ├── i18n.js
│   └── widget.css
│
├── config/            # Config editor
│   ├── config-editor.html
│   ├── config-editor.css
│   └── config-editor.js
│
├── server/            # Python server
│   ├── server.py
│   └── connectors/
│       └── postgresql.py
│
└── demo/              # Demo
    ├── index.html
    ├── example.html
    ├── demo-example.html
    ├── demo-data.js
    └── demo-config.js
```

## License

Free for personal and non-commercial use.  
For commercial use, a license is required — contact [korolevalexa@gmail.com](mailto:korolevalexa@gmail.com).
