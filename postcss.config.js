import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export default {
  plugins: [
    require(join(__dirname, 'node_modules', 'tailwindcss')),
    require(join(__dirname, 'node_modules', 'autoprefixer')),
  ],
};
