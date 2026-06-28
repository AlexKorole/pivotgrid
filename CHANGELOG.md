# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.10] - 2026-06-27

### Added
- `CHANGELOG.md` to track notable changes to this project going forward.

### Changed
- SQL aggregate expressions and `ColumnStore` measure columns are now
  generated from a per-function plan instead of a literal `func(measure)`
  mapping, with shared raw components (e.g. `sum`/`count` needed by both
  `sum` and `avg` on the same measure) deduplicated rather than computed
  twice.

### Fixed
- `min`, `max`, `avg`, `variance`, and `stddev` were silently incorrect
  whenever multiple cached rows folded into a single pivot cell (e.g.
  collapsing a cached GROUP BY over *n* dimensions down to *n − a*
  dimensions) — all functions were combined with plain `+=`, so e.g. summing
  per-row maximums instead of taking their maximum. Aggregation is now
  classified as distributive (`sum`, `count`, `min`, `max` — combined
  directly) or algebraic (`avg`, `variance`, `stddev` — combined via raw
  `sum` / `count` / `sum_sq` components and derived once at the end).
  `variance`/`stddev` use sample variance (`n − 1`), matching PostgreSQL's
  default `VARIANCE()` / `STDDEV()`.
- Column groups (`collapsedCols`) were reset on every `setResult()` call,
  even when only the measure or function changed and the column dimensions
  themselves stayed the same — collapsing columns the user had just
  expanded. `collapsedCols` now only resets when the `columns` dimensions
  actually change.

### Security
- Filter values built into SQL (`_buildWhere` / `_buildFiltersWhere`) were
  escaped and concatenated directly into the query string. Switched to
  parameterized queries — values are now bound via `%(pN)s` placeholders and
  passed separately as `params`, handled by the DB driver instead of manual
  escaping. Column/dimension names still come exclusively from the trusted
  server-side config (`this.fields`), never from user input.
