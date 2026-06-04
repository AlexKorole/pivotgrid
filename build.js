const esbuild = require('esbuild');

// All source files in dependency order
const sourceFiles = [
  'engine/dictionary-encoder.js',
  'engine/column-store.js',
  'engine/aggregator.js',
  'providers/array-provider.js',
  'providers/rest-provider.js',
  'src/pivot.js',
  'src/field-zones.js',
  'src/filter-manager.js',
  'widget/i18n.js',
  'widget/cache-manager.js',
];

const shared = {
  bundle: false,
  sourcemap: false,
  target: ['es2018'],
};

// IIFE — for direct <script> usage (minified)
esbuild.build({
  ...shared,
  entryPoints: sourceFiles,
  outdir: 'dist/esm',
  format: 'esm',
}).then(() => {
  // Concatenate into single files
  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync('dist')) fs.mkdirSync('dist');

  const concat = sourceFiles
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  // Plain bundle — classes as globals (for <script> usage)
  fs.writeFileSync('dist/pivotgrid.js', concat);
  console.log('✓ pivotgrid.js built');

  // Minified IIFE
  esbuild.build({
    stdin: { contents: concat, loader: 'js' },
    bundle: false,
    minify: true,
    format: 'iife',
    globalName: 'PivotGridLib',
    outfile: 'dist/pivotgrid.min.js',
  }).then(() => console.log('✓ pivotgrid.min.js built'));

  // ESM with exports
  const esm = concat + `\nexport { DictionaryEncoder, ColumnStore, Aggregator, ArrayProvider, RestProvider, PivotGrid, FieldZones, FilterManager, CacheManager, I18N };\n`;
  fs.writeFileSync('dist/pivotgrid.esm.js', esm);
  console.log('✓ pivotgrid.esm.js built');

  // CJS with exports
  const cjs = concat + `\nmodule.exports = { DictionaryEncoder, ColumnStore, Aggregator, ArrayProvider, RestProvider, PivotGrid, FieldZones, FilterManager, CacheManager, I18N };\n`;
  fs.writeFileSync('dist/pivotgrid.cjs.js', cjs);
  console.log('✓ pivotgrid.cjs.js built');

  // CSS bundle
  const cssFiles = [
    'src/pivot.css',
    'src/field-zones.css',
    'widget/widget.css',
  ];
  const css = cssFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  fs.writeFileSync('dist/pivotgrid.css', css);
  console.log('✓ pivotgrid.css built');

  // Cleanup temp dir
  fs.rmSync('dist/esm', { recursive: true, force: true });
});
