# PivotGrid

Vanilla JS сводная таблица — без зависимостей, без фреймворков.

- **Быстро** — виртуальный скролл, columnar-хранилище на TypedArrays, in-memory кэш
- **Гибко** — drag-and-drop измерений, фильтры, иерархические строки и колонки
- **Просто** — один `<div>` и два атрибута, больше ничего не нужно

## Концепция

Вся настройка — через конфиг. API грида намеренно минимален:
достаточно создать контейнер с `data-config` и виджет сделает остальное.

Конфиг хранится на сервере и загружается при старте —
не нужно менять код приложения чтобы изменить структуру грида.

## Быстрый старт

```html
<!-- Стили -->
<link rel="stylesheet" href="src/pivot.css">
<link rel="stylesheet" href="src/field-zones.css">
<link rel="stylesheet" href="widget/widget.css">

<!-- Engine -->
<script src="engine/dictionary-encoder.js"></script>
<script src="engine/aggregator.js"></script>
<script src="engine/column-store.js"></script>

<!-- Провайдеры -->
<script src="providers/rest-provider.js"></script>
<script src="providers/array-provider.js"></script>

<!-- Компонент -->
<script src="src/pivot.js"></script>
<script src="src/field-zones.js"></script>
<script src="src/filter-manager.js"></script>

<!-- Виджет -->
<script src="widget/i18n.js"></script>
<script src="widget/cache-manager.js"></script>
<script src="widget/pivot-widget.js"></script>

<!-- Грид -->
<div id="my-pivot"
     data-config="sales"
     data-server="http://localhost:8000">
</div>
```

Виджет сам создаёт всю структуру интерфейса внутри контейнера.

## Демо без сервера

```html
<!-- Демо-данные и конфиг -->
<script src="demo/demo-data.js"></script>
<script src="demo/demo-config.js"></script>

<div id="my-pivot" data-demo="true"></div>
```

## Атрибуты контейнера

| Атрибут | Описание | Пример |
|---------|----------|--------|
| `data-config` | Имя конфига на сервере | `"sales"` |
| `data-server` | URL сервера | `"http://localhost:8000"` |
| `data-demo` | Демо-режим без сервера | `"true"` |
| `data-lang` | Язык интерфейса | `"ru"` / `"en"` |
| `data-standalone` | Использовать готовую HTML-структуру | `"true"` |

## Конфиг

Конфиг хранится на сервере в `configs/{name}.json`:

```json
{
  "query": "SELECT * FROM sales_data",

  "dimensions": ["region", "category", "channel"],
  "measures":   ["revenue", "units"],
  "funcs":      ["sum", "avg", "count", "min", "max"],

  "fields": {
    "region":   { "label": "region",   "title": "Регион" },
    "category": { "label": "category", "title": "Категория" },
    "channel":  { "label": "channel",  "title": "Канал" },
    "revenue":  { "label": "revenue",  "title": "Выручка" },
    "units":    { "label": "units",    "title": "Единицы" }
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

## Сервер

`server/server.py` — лёгкий Python-прокси к БД.

```bash
pip install psycopg2-binary
python server/server.py
```

### Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/query` | Выполнить SQL запрос |
| `GET` | `/configs` | Список конфигов |
| `GET` | `/configs/{name}` | Получить конфиг |
| `POST` | `/configs/{name}` | Сохранить конфиг |
| `GET` | `/server-config` | Настройки БД (без пароля) |
| `POST` | `/server-config` | Сохранить настройки БД |

### Коннекторы БД

По умолчанию включён PostgreSQL. Чтобы добавить свою БД — создайте файл в `server/connectors/`:

```python
# server/connectors/mydb.py
NAME = "My Database"

def execute_query(query):
    # ваша реализация
    return [{"col": "val"}, ...]
```

Сервер подхватит новый коннектор при следующем запуске.

## Config Editor

Графический редактор конфигов — `config/config-editor.html`.

- Получить колонки из БД одной кнопкой
- Настроить измерения, меры, sortKey
- Drag-and-drop начального состояния (строки / колонки / кэш)
- Сохранить конфиг на сервер
- Предпросмотр изменений без сохранения

## API грида

```js
// Развернуть / свернуть строки
grid.expandAll()
grid.collapseAll()
grid.expandToDepth(depth)

// Развернуть / свернуть колонки
grid.expandAllCols()
grid.collapseAllCols()

// Подитоги
grid.toggleSubtotals(visible)

// Обновить данные
grid.setResult(result, { rows, columns, measure, fieldDefs })
```

## Drillthrough

При клике на ячейку диспатчится событие `drillthrough`:

```js
container.addEventListener('drillthrough', (e) => {
  const { context, value } = e.detail;
  // context = { region: 'Север', channel: 'Онлайн' }
  // value   = агрегированное значение ячейки
});
```

Поведение при клике задаётся в конфиге:

```json
"drillthroughQuery": "SELECT * FROM sales WHERE {filters} LIMIT 200"
```

или

```json
"drillthroughUrl": "https://myapp.com/details"
```

## Интернационализация

```html
<div data-config="sales" data-lang="en"></div>
```

Поддерживаются `ru` и `en`. Добавить язык — расширить объект `I18N` в `widget/i18n.js`.

## Структура проекта

```
├── src/               # Компонент
│   ├── pivot.js
│   ├── pivot.css
│   ├── field-zones.js
│   ├── field-zones.css
│   └── filter-manager.js
│
├── engine/            # Движок агрегации
│   ├── aggregator.js
│   ├── column-store.js
│   └── dictionary-encoder.js
│
├── providers/         # Провайдеры данных
│   ├── rest-provider.js
│   └── array-provider.js
│
├── widget/            # Виджет (UI + инициализация)
│   ├── pivot-widget.js
│   ├── cache-manager.js
│   ├── i18n.js
│   └── widget.css
│
├── config/            # Редактор конфигов
│   ├── config-editor.html
│   ├── config-editor.css
│   └── config-editor.js
│
├── server/            # Python-сервер
│   ├── server.py
│   └── connectors/
│       └── postgresql.py
│
└── demo/              # Демо
    ├── index.html
    ├── example.html
    ├── demo-example.html
    ├── demo-data.js
    └── demo-config.js
```

## Лицензия

Бесплатно для личного и некоммерческого использования.  
Для коммерческого использования требуется лицензия — свяжитесь с [korolevalexa@gmail.com](mailto:korolevalexa@gmail.com)
