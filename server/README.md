# PivotGrid Server

A lightweight Python proxy between PivotGrid and your database.

## Requirements

- Python 3.8+
- psycopg2-binary (for PostgreSQL)

## Installation

```bash
pip install psycopg2-binary
```

## Start

```bash
python server.py
```

Server starts on `http://localhost:8000` by default.

## Configuration

Settings are stored in a `.env` file in the `server/` directory:

```env
PORT=8000

DB_CONNECTOR=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=secret
```

All settings can also be configured via the Config Editor UI.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/query` | Execute a SELECT query, returns paginated JSON (`{rows, total, page, hasMore}`) |
| `GET` | `/configs` | List all config names |
| `GET` | `/configs/{name}` | Get a config by name |
| `POST` | `/configs/{name}` | Save a config by name |
| `GET` | `/server-config` | Get DB settings (password excluded) |
| `POST` | `/server-config` | Save DB settings to `.env` |
| `POST` | `/test-connection` | Test DB connection with given credentials |

## Query Pagination

Large result sets are split into pages to avoid sending huge HTTP responses
(which can fail or time out on slower connections).

The query runs **once** — results are cached in memory on the server and
sliced into pages as the client requests them, so a single `GROUP BY` is
never re-executed for each page.

```python
_PAGE_SIZE = 200_000       # rows per page sent to the client
_QUERY_CACHE_TTL = 300     # seconds a query's results stay in server memory
```

- `_PAGE_SIZE` — increase if your network/hardware comfortably handles
  larger responses; decrease if you see slow or failing requests on big
  datasets.
- `_QUERY_CACHE_TTL` — how long the server keeps a query's full result in
  memory while the client fetches subsequent pages. Stale entries are
  cleaned up automatically.

The client (`RestProvider`) handles pagination transparently — it requests
pages in a loop and concatenates them into a single array.

## Configs

Configs are stored as JSON files in `server/configs/`:

```
server/
└── configs/
    ├── sales.json
    ├── orders.json
    └── ...
```

## Adding a Custom DB Connector

Create a file in `server/connectors/`:

```python
# server/connectors/mydb.py
NAME = "My Database"

def execute_query(query):
    # your implementation
    return [{"col": "val"}, ...]

def test_connection(host, port, dbname, user, password):
    # optional — enables "Test connection" button in Config Editor
    pass
```

The server picks up the new connector on next startup.

## Notes

- Only `SELECT` queries are allowed via `/query`
- Password is never returned by `/server-config`
- CORS is enabled for all origins (`*`) — restrict in production if needed
