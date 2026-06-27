"""
PostgreSQL connector.

Installation:
    pip install psycopg2-binary
"""

import os
import psycopg2
import psycopg2.extras

NAME = "PostgreSQL"

def execute_query(query, params=None):
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST",     "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME",   "postgres"),
        user=os.getenv("DB_USER",     "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(query, params or {})   # psycopg2 binds %(name)s placeholders from the dict
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

def test_connection(host, port, dbname, user, password):
    conn = psycopg2.connect(
        host=host, port=int(port), dbname=dbname,
        user=user, password=password,
    )
    conn.close()
