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
| `POST` | `/query` | Execute a SELECT query, returns JSON array |
| `GET` | `/configs` | List all config names |
| `GET` | `/configs/{name}` | Get a config by name |
| `POST` | `/configs/{name}` | Save a config by name |
| `GET` | `/server-config` | Get DB settings (password excluded) |
| `POST` | `/server-config` | Save DB settings to `.env` |
| `POST` | `/test-connection` | Test DB connection with given credentials |

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
