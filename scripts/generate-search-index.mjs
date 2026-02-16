/**
 * Generates search-index.json and locations-compare.json at build time.
 * Run before astro build: node scripts/generate-search-index.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Dynamic import of TypeScript data files compiled to JS
// Since we're using Astro with TS, we need to read the TS files directly and extract data.
// Instead, we'll use a simpler approach: import from the built data.

// Helper: read TS file and extract the array
function parseDataFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  // Extract the array from the export const XXXX: Type[] = [...]
  const match = content.match(/export const \w+(?::\s*\w+\[\])?\s*=\s*(\[[\s\S]*?\n\];)/);
  if (!match) {
    console.error(`Could not parse data from ${filePath}`);
    return [];
  }
  try {
    // Clean up TypeScript syntax for JSON parsing
    let arrayStr = match[1];
    // Remove trailing semicolon
    arrayStr = arrayStr.replace(/;\s*$/, '');
    // Use Function constructor to evaluate
    return new Function(`return ${arrayStr}`)();
  } catch (e) {
    console.error(`Error parsing ${filePath}:`, e.message);
    return [];
  }
}

const zupanije = parseDataFile(join(root, 'src/data/zupanije.ts'));
const gradovi = parseDataFile(join(root, 'src/data/gradovi.ts'));
const opcine = parseDataFile(join(root, 'src/data/opcine.ts'));

console.log(`Loaded: ${zupanije.length} counties, ${gradovi.length} cities, ${opcine.length} municipalities`);

// Generate search index (compact)
const searchIndex = [
  ...zupanije.map(z => ({
    name: z.name,
    slug: z.slug,
    type: 'zupanija',
    county: '',
    pop: z.population_2021,
  })),
  ...gradovi.map(g => ({
    name: g.name,
    slug: g.slug,
    type: 'grad',
    county: g.county_name,
    pop: g.population_2021,
  })),
  ...opcine.map(o => ({
    name: o.name,
    slug: o.slug,
    type: 'opcina',
    county: o.county_name,
    pop: o.population_2021,
  })),
];

// Generate compare data (more fields)
const compareData = [
  ...gradovi.map(g => ({
    name: g.name,
    slug: g.slug,
    type: g.type,
    county_name: g.county_name,
    population_2021: g.population_2021,
    change_pct: g.change_pct,
    density: g.density,
    avg_age: g.avg_age,
    education_university_pct: g.education_university_pct,
    male_pct: g.male_pct,
    female_pct: g.female_pct,
  })),
  ...opcine.map(o => ({
    name: o.name,
    slug: o.slug,
    type: o.type,
    county_name: o.county_name,
    population_2021: o.population_2021,
    change_pct: o.change_pct,
    density: o.density,
    avg_age: o.avg_age,
    education_university_pct: o.education_university_pct,
    male_pct: o.male_pct,
    female_pct: o.female_pct,
  })),
];

mkdirSync(join(root, 'public'), { recursive: true });

writeFileSync(
  join(root, 'public/search-index.json'),
  JSON.stringify(searchIndex),
  'utf-8'
);
console.log(`Written search-index.json (${searchIndex.length} entries)`);

writeFileSync(
  join(root, 'public/locations-compare.json'),
  JSON.stringify(compareData),
  'utf-8'
);
console.log(`Written locations-compare.json (${compareData.length} entries)`);
