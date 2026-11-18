import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

process.env.VITE_BASE_PATH = '/kasku/';

await build({
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});

fs.writeFileSync(path.resolve('docs/.nojekyll'), '');

console.log('GitHub Pages build siap di docs/ dengan base /kasku/');
