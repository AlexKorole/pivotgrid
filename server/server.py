"""
server.py — прокси к БД + хранилище конфигов

Эндпоинты:
    POST /query                → выполнить SELECT, вернуть JSON массив
    GET  /configs              → список имён конфигов
    GET  /configs/{name}       → получить конфиг по имени
    POST /configs/{name}       → сохранить конфиг по имени
    GET  /server-config        → настройки БД (без пароля) + список коннекторов
    POST /server-config        → сохранить настройки БД в .env

Коннекторы: добавьте файл в ./connectors/ с NAME и execute_query(query).
Конфиги:    хранятся в ./configs/{name}.json
Настройки:  хранятся в .env

Установка (для PostgreSQL):
    pip install psycopg2-binary

Запуск:
    python server.py
"""

import json
import gzip
import os
import re
import importlib.util
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn


# ── Пути ──────────────────────────────────────────────────────────────────────

BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
ENV_PATH        = os.path.join(BASE_DIR, '.env')
CONFIGS_DIR     = os.path.join(BASE_DIR, 'configs')
CONNECTORS_DIR  = os.path.join(BASE_DIR, 'connectors')

os.makedirs(CONFIGS_DIR, exist_ok=True)

# ── Загрузка .env ─────────────────────────────────────────────────────────────

def load_env(path):
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            os.environ[key.strip()] = val.strip()

load_env(ENV_PATH)

# ── Коннекторы ────────────────────────────────────────────────────────────────

def load_connectors():
    """Сканирует connectors/ и загружает все модули с NAME и execute_query."""
    connectors = {}
    if not os.path.exists(CONNECTORS_DIR):
        return connectors
    for fname in sorted(os.listdir(CONNECTORS_DIR)):
        if not fname.endswith('.py') or fname.startswith('_'):
            continue
        module_name = fname[:-3]
        path = os.path.join(CONNECTORS_DIR, fname)
        try:
            spec   = importlib.util.spec_from_file_location(module_name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            if hasattr(module, 'NAME') and hasattr(module, 'execute_query'):
                connectors[module_name] = module
                print(f'Connector loaded: {module.NAME} ({module_name})')
        except Exception as e:
            print(f'Connector error [{module_name}]: {e}')
    return connectors

CONNECTORS = load_connectors()

def get_active_connector():
    """Возвращает активный коннектор по DB_CONNECTOR из .env."""
    name = os.getenv('DB_CONNECTOR', '')
    if name and name in CONNECTORS:
        return CONNECTORS[name]
    # Берём первый доступный
    if CONNECTORS:
        return next(iter(CONNECTORS.values()))
    raise RuntimeError('Нет доступных коннекторов в ./connectors/')

# ── Конфиг ────────────────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "8000"))

CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

def valid_config_name(name):
    return bool(re.match(r'^[\w\-]+$', name))

def config_path(name):
    return os.path.join(CONFIGS_DIR, f"{name}.json")

def save_env(data):
    """Сохраняет настройки в .env, не трогая остальные переменные."""
    lines = []
    protected = {'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_CONNECTOR'}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                key = line.partition('=')[0].strip()
                if key not in protected:
                    lines.append(line.rstrip('\n'))

    if 'host'      in data: lines.append(f"DB_HOST={data['host']}")
    if 'port'      in data: lines.append(f"DB_PORT={data['port']}")
    if 'dbname'    in data: lines.append(f"DB_NAME={data['dbname']}")
    if 'user'      in data: lines.append(f"DB_USER={data['user']}")
    if 'password'  in data and data['password']:
        lines.append(f"DB_PASSWORD={data['password']}")
    if 'connector' in data: lines.append(f"DB_CONNECTOR={data['connector']}")

    with open(ENV_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    # Обновляем os.environ сразу
    for key, env_key in [('host','DB_HOST'),('port','DB_PORT'),('dbname','DB_NAME'),
                          ('user','DB_USER'),('connector','DB_CONNECTOR')]:
        if key in data:
            os.environ[env_key] = str(data[key])
    if 'password' in data and data['password']:
        os.environ['DB_PASSWORD'] = data['password']

# ── Handler ───────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_OPTIONS(self):
        self._send(200, '')

    # ── GET ───────────────────────────────────────────────────────────────────

    def do_GET(self):
        # GET /configs → список имён
        if self.path == '/configs':
            names = sorted(f[:-5] for f in os.listdir(CONFIGS_DIR) if f.endswith('.json'))
            self._send(200, json.dumps(names))
            return

        # GET /configs/{name} → конфиг
        m = re.match(r'^/configs/([\w\-]+)$', self.path)
        if m:
            name = m.group(1)
            if not valid_config_name(name):
                self._send(400, json.dumps({'error': 'Invalid config name'}))
                return
            path = config_path(name)
            if not os.path.exists(path):
                self._send(404, json.dumps({'error': f'Config "{name}" not found'}))
                return
            with open(path, 'r', encoding='utf-8') as f:
                self._send(200, f.read())
            return

        # GET /server-config → настройки БД (без пароля) + коннекторы
        if self.path == '/server-config':
            active = os.getenv('DB_CONNECTOR', next(iter(CONNECTORS), ''))
            result = {
                'host':       os.getenv('DB_HOST',    'localhost'),
                'port':       os.getenv('DB_PORT',    '5432'),
                'dbname':     os.getenv('DB_NAME',    'postgres'),
                'user':       os.getenv('DB_USER',    'postgres'),
                'connector':  active,
                'connectors': {k: v.NAME for k, v in CONNECTORS.items()},
            }
            self._send(200, json.dumps(result))
            return

        self._send(404, json.dumps({'error': 'Not found'}))

    # ── POST ──────────────────────────────────────────────────────────────────

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        if self.path == '/query':
            self._handle_query(body)
            return

        if self.path == '/server-config':
            self._handle_save_server_config(body)
            return

        if self.path == '/test-connection':
            self._handle_test_connection(body)
            return

        m = re.match(r'^/configs/([\w\-]+)$', self.path)
        if m:
            self._handle_save_config(m.group(1), body)
            return

        self._send(404, json.dumps({'error': 'Not found'}))

    # ── SQL запрос ────────────────────────────────────────────────────────────

    def _handle_query(self, body):
        try:
            payload = json.loads(body)
        except Exception:
            self._send(400, json.dumps({'error': 'Invalid JSON'}))
            return

        query = payload.get('query', '').strip()
        if not query.upper().startswith('SELECT'):
            self._send(400, json.dumps({'error': 'Only SELECT allowed'}))
            return

        try:
            connector = get_active_connector()
            rows      = connector.execute_query(query)
            self._send(200, json.dumps(rows, ensure_ascii=False, default=str))
        except Exception as e:
            self._send(500, json.dumps({'error': str(e)}))

    # ── Сохранить конфиг ──────────────────────────────────────────────────────

    def _handle_save_config(self, name, body):
        if not valid_config_name(name):
            self._send(400, json.dumps({'error': 'Invalid config name'}))
            return
        try:
            data = json.loads(body)
            with open(config_path(name), 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f'Config saved: {name}')
            self._send(200, json.dumps({'ok': True, 'name': name}))
        except json.JSONDecodeError:
            self._send(400, json.dumps({'error': 'Invalid JSON'}))
        except Exception as e:
            self._send(500, json.dumps({'error': str(e)}))

    # ── Сохранить настройки БД ────────────────────────────────────────────────

    def _handle_save_server_config(self, body):
        try:
            data = json.loads(body)
            save_env(data)
            print('Server config saved')
            self._send(200, json.dumps({'ok': True}))
        except json.JSONDecodeError:
            self._send(400, json.dumps({'error': 'Invalid JSON'}))
        except Exception as e:
            self._send(500, json.dumps({'error': str(e)}))

    def _handle_test_connection(self, body):
        try:
            data = json.loads(body)
            connector = get_active_connector()
            if not hasattr(connector, 'test_connection'):
                self._send(400, json.dumps({'error': 'Коннектор не поддерживает проверку соединения'}))
                return
            connector.test_connection(
                host=data.get('host', os.getenv('DB_HOST', 'localhost')),
                port=data.get('port', os.getenv('DB_PORT', '5432')),
                dbname=data.get('dbname', os.getenv('DB_NAME', 'postgres')),
                user=data.get('user', os.getenv('DB_USER', 'postgres')),
                password=data.get('password', os.getenv('DB_PASSWORD', '')),
            )
            self._send(200, json.dumps({'ok': True}))
        except Exception as e:
            self._send(500, json.dumps({'error': str(e)}))

    # ── HTTP response ─────────────────────────────────────────────────────────

    def _send(self, status, body, content_type='application/json; charset=utf-8'):
        encoded = body.encode('utf-8') if isinstance(body, str) else body
        accept_encoding = self.headers.get('Accept-Encoding', '')
        use_gzip = 'gzip' in accept_encoding and len(encoded) > 1024
        if use_gzip:
            encoded = gzip.compress(encoded, compresslevel=6)
        self.send_response(status)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.send_header('Content-Type',   content_type)
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Connection',     'keep-alive')
        if use_gzip:
            self.send_header('Content-Encoding', 'gzip')
        self.end_headers()
        if encoded:
            self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        print(f'{self.address_string()} — {fmt % args}')

# ── Запуск ────────────────────────────────────────────────────────────────────

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    server = ThreadingHTTPServer(('localhost', PORT), Handler)
    print(f'Server:      http://localhost:{PORT}')
    print(f'Configs:     {CONFIGS_DIR}')
    print(f'Connectors:  {list(CONNECTORS.keys())}')
    server.serve_forever()
