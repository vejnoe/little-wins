// Preflight for CI: fail early if a file referenced by the app is missing.
// Runs from the repo root; reads only the three entry points that hold local paths.
const fs = require('fs');

const SOURCES = ['index.html', 'manifest.json', 'sw.js'];
const LOCAL_FILE = /(?:["'(])(?:\.\/)?([A-Za-z0-9_./-]+\.(?:js|css|png|mp3|json|html))(?=["')])/g;

const refs = new Set();
for (const file of SOURCES) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(LOCAL_FILE)) refs.add(match[1]);
}

const missing = [...refs].filter((file) => !fs.existsSync(file));
if (missing.length) {
  console.error('Missing referenced assets:', missing.join(', '));
  process.exit(1);
}
console.log(`OK — ${refs.size} referenced assets found`);
