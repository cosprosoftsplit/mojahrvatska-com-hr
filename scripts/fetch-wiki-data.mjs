/**
 * fetch-wiki-data.mjs
 * One-time enrichment script: fetches Wikidata + HR Wikipedia data for all Croatian locations.
 * Output: src/data/wiki-enrichment.json
 *
 * Usage: node scripts/fetch-wiki-data.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Parse TypeScript data files (reuse pattern from generate-search-index.mjs)
// ---------------------------------------------------------------------------
function parseTS(filePath, varName) {
  const src = fs.readFileSync(filePath, 'utf-8');
  // Extract the array literal
  const re = new RegExp(`export\\s+const\\s+${varName}[^=]*=\\s*\\[`, 's');
  const m = src.match(re);
  if (!m) throw new Error(`Cannot find ${varName} in ${filePath}`);
  const start = m.index + m[0].length - 1; // position of '['
  let depth = 0, end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') depth++;
    if (src[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const arrayStr = src.slice(start, end);
  // Convert TS to valid JS: remove type annotations, handle single-quoted strings
  const cleaned = arrayStr
    .replace(/as\s+const/g, '')
    .replace(/'grad'/g, '"grad"')
    .replace(/'opcina'/g, '"opcina"');
  return new Function(`return ${cleaned}`)();
}

const zupanije = parseTS(path.join(ROOT, 'src/data/zupanije.ts'), 'ZUPANIJE');
const gradovi = parseTS(path.join(ROOT, 'src/data/gradovi.ts'), 'GRADOVI');
const opcine = parseTS(path.join(ROOT, 'src/data/opcine.ts'), 'OPCINE');

console.log(`Loaded: ${zupanije.length} counties, ${gradovi.length} cities, ${opcine.length} municipalities`);

// Build flat list of all locations for processing
const allLocations = [
  ...zupanije.map(z => ({ ...z, type: 'zupanija', wikiTitle: z.name })),
  ...gradovi.map(g => ({
    ...g,
    wikiTitle: g.name === 'Zagreb' ? 'Zagreb' : g.name,
  })),
  ...opcine.map(o => ({
    ...o,
    wikiTitle: o.name,
  })),
];

// ---------------------------------------------------------------------------
// 2. Wikidata SPARQL — fetch structured metadata
// ---------------------------------------------------------------------------
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

// Wikipedia title -> Wikidata item mapping via Croatian Wikipedia article titles
const SPARQL_QUERY = `
SELECT ?item ?itemLabel ?coatOfArms ?photo ?postalCode ?elevation ?website ?licensePlate ?sisterCityLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q486972 .  # instance of human settlement (broadly)
  ?item wdt:P17 wd:Q224 .                # country = Croatia
  OPTIONAL { ?item wdt:P94 ?coatOfArms . }
  OPTIONAL { ?item wdt:P18 ?photo . }
  OPTIONAL { ?item wdt:P281 ?postalCode . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P395 ?licensePlate . }
  OPTIONAL { ?item wdt:P190 ?sisterCity . ?sisterCity rdfs:label ?sisterCityLabel . FILTER(LANG(?sisterCityLabel) = "hr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "hr,en" . }
}
`;

// Also fetch counties specifically (Q5765585 = county of Croatia)
const SPARQL_COUNTIES = `
SELECT ?item ?itemLabel ?coatOfArms ?photo ?postalCode ?elevation ?website ?licensePlate ?sisterCityLabel WHERE {
  ?item wdt:P31 wd:Q5765585 .            # instance of county of Croatia
  OPTIONAL { ?item wdt:P94 ?coatOfArms . }
  OPTIONAL { ?item wdt:P18 ?photo . }
  OPTIONAL { ?item wdt:P281 ?postalCode . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P395 ?licensePlate . }
  OPTIONAL { ?item wdt:P190 ?sisterCity . ?sisterCity rdfs:label ?sisterCityLabel . FILTER(LANG(?sisterCityLabel) = "hr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "hr,en" . }
}
`;

// Also fetch cities of Croatia (Q2616791)
const SPARQL_CITIES = `
SELECT ?item ?itemLabel ?coatOfArms ?photo ?postalCode ?elevation ?website ?licensePlate ?sisterCityLabel WHERE {
  ?item wdt:P31 wd:Q2616791 .            # instance of city of Croatia
  OPTIONAL { ?item wdt:P94 ?coatOfArms . }
  OPTIONAL { ?item wdt:P18 ?photo . }
  OPTIONAL { ?item wdt:P281 ?postalCode . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P395 ?licensePlate . }
  OPTIONAL { ?item wdt:P190 ?sisterCity . ?sisterCity rdfs:label ?sisterCityLabel . FILTER(LANG(?sisterCityLabel) = "hr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "hr,en" . }
}
`;

// Also fetch municipalities of Croatia (Q1196726)
const SPARQL_MUNICIPALITIES = `
SELECT ?item ?itemLabel ?coatOfArms ?photo ?postalCode ?elevation ?website ?licensePlate ?sisterCityLabel WHERE {
  ?item wdt:P31 wd:Q1196726 .            # instance of municipality of Croatia
  OPTIONAL { ?item wdt:P94 ?coatOfArms . }
  OPTIONAL { ?item wdt:P18 ?photo . }
  OPTIONAL { ?item wdt:P281 ?postalCode . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P395 ?licensePlate . }
  OPTIONAL { ?item wdt:P190 ?sisterCity . ?sisterCity rdfs:label ?sisterCityLabel . FILTER(LANG(?sisterCityLabel) = "hr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "hr,en" . }
}
`;

async function fetchSparql(query, label) {
  console.log(`Fetching Wikidata SPARQL (${label})...`);
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MojaHrvatska/1.0 (mojahrvatska.com.hr) Node.js' },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.results.bindings;
}

function processWikidataResults(bindings) {
  // Group by item label (our location name)
  const byName = {};
  for (const row of bindings) {
    const name = row.itemLabel?.value;
    if (!name) continue;

    if (!byName[name]) {
      byName[name] = {
        coatOfArms: null,
        photo: null,
        postalCode: null,
        elevation: null,
        officialWebsite: null,
        licensePlate: null,
        sisterCities: [],
      };
    }
    const entry = byName[name];
    if (row.coatOfArms?.value && !entry.coatOfArms) entry.coatOfArms = row.coatOfArms.value;
    if (row.photo?.value && !entry.photo) entry.photo = row.photo.value;
    if (row.postalCode?.value && !entry.postalCode) entry.postalCode = row.postalCode.value;
    if (row.elevation?.value && !entry.elevation) entry.elevation = parseFloat(row.elevation.value);
    if (row.website?.value && !entry.officialWebsite) entry.officialWebsite = row.website.value;
    if (row.licensePlate?.value && !entry.licensePlate) entry.licensePlate = row.licensePlate.value;
    if (row.sisterCityLabel?.value) {
      const sc = row.sisterCityLabel.value;
      if (!entry.sisterCities.includes(sc)) entry.sisterCities.push(sc);
    }
  }
  return byName;
}

// ---------------------------------------------------------------------------
// 3. HR Wikipedia REST API — fetch Croatian descriptions + thumbnails
// ---------------------------------------------------------------------------
async function fetchWikipediaSummary(title) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://hr.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MojaHrvatska/1.0 (mojahrvatska.com.hr) Node.js' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      description: data.extract || null,
      thumbnail: data.thumbnail?.source || null,
    };
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Wikipedia article title mapping — location name -> Wikipedia article title
// Most locations have direct articles, but some need disambiguation
function getWikiTitle(location) {
  const name = location.name;
  const type = location.type;

  // Counties: article title is just the county name
  if (type === 'zupanija') return name;

  // Special cases where Wikipedia article differs from our name
  const titleMap = {
    // Cities that might need disambiguation
    'Grad Zagreb': 'Zagreb',
  };

  if (titleMap[name]) return titleMap[name];

  // For municipalities, Wikipedia often uses "Općina X" or just "X"
  // Try the plain name first, the script handles 404s gracefully
  return name;
}

// ---------------------------------------------------------------------------
// 4. Generate analytical conclusions from census data
// ---------------------------------------------------------------------------
function generateConclusions(location, type, zupanije, gradovi, opcine) {
  const conclusions = [];

  // National averages (approximate from census 2021)
  const nationalPop = 3871833;
  const nationalDensity = 68.4; // Croatia's density
  const nationalAvgAge = 43.7;
  const nationalUniversityPct = 18.4;
  const nationalChange = -9.64; // 2011-2021
  const nationalAge65Plus = 22.4;
  const nationalAge014 = 14.2;

  const pop = location.population_2021;
  const change = location.change_pct;
  const density = location.density;
  const avgAge = location.avg_age;
  const age65 = location.age_65_plus_pct;
  const age014 = location.age_0_14_pct;

  // 1. Population change verdict
  if (change > 5) {
    conclusions.push(`Stanovništvo bilježi značajan rast od ${change.toFixed(1)}% u desetljeću 2011.–2021., što je znatno iznad nacionalnog trenda (${nationalChange.toFixed(1)}%).`);
  } else if (change > 0) {
    conclusions.push(`Stanovništvo bilježi blagi rast od ${change.toFixed(1)}% u desetljeću 2011.–2021., suprotno od nacionalnog trenda pada.`);
  } else if (change > -5) {
    conclusions.push(`Stanovništvo bilježi umjereni pad od ${change.toFixed(1)}% u razdoblju 2011.–2021., što je blaže od nacionalnog prosjeka (${nationalChange.toFixed(1)}%).`);
  } else if (change > -15) {
    conclusions.push(`Stanovništvo bilježi značajan pad od ${change.toFixed(1)}% u desetljeću 2011.–2021.`);
  } else {
    conclusions.push(`Stanovništvo bilježi drastičan pad od ${change.toFixed(1)}% u razdoblju 2011.–2021., što ukazuje na snažne demografske izazove.`);
  }

  // 2. Density comparison
  if (type !== 'zupanija') {
    if (density > nationalDensity * 5) {
      conclusions.push(`Gustoća naseljenosti (${density.toFixed(0)}/km²) znatno je iznad nacionalnog prosjeka (${nationalDensity}/km²).`);
    } else if (density > nationalDensity * 1.5) {
      conclusions.push(`Gustoća naseljenosti (${density.toFixed(0)}/km²) iznad je nacionalnog prosjeka (${nationalDensity}/km²).`);
    } else if (density < nationalDensity * 0.5) {
      conclusions.push(`Gustoća naseljenosti (${density.toFixed(0)}/km²) ispod je nacionalnog prosjeka (${nationalDensity}/km²), što ukazuje na ruralni karakter.`);
    }
  }

  // 3. Age structure assessment
  if (avgAge > 48) {
    conclusions.push(`Prosječna starost od ${avgAge.toFixed(1)} godina značajno je iznad nacionalnog prosjeka (${nationalAvgAge}), što ukazuje na izrazito staro stanovništvo.`);
  } else if (avgAge > nationalAvgAge + 2) {
    conclusions.push(`Prosječna starost od ${avgAge.toFixed(1)} godina iznad je nacionalnog prosjeka (${nationalAvgAge}).`);
  } else if (avgAge < nationalAvgAge - 3) {
    conclusions.push(`Prosječna starost od ${avgAge.toFixed(1)} godina ispod je nacionalnog prosjeka (${nationalAvgAge}), što ukazuje na mlađe stanovništvo.`);
  }

  // 4. Youth vs elderly ratio
  if (age014 > 16) {
    conclusions.push(`Udio mladih (0–14 godina) od ${age014.toFixed(1)}% iznad je nacionalnog prosjeka (${nationalAge014}%), što upućuje na povoljniju demografsku sliku.`);
  }
  if (age65 > 28) {
    conclusions.push(`Udio stanovništva starijih od 65 godina (${age65.toFixed(1)}%) znatno je iznad prosjeka, što predstavlja demografski izazov.`);
  }

  // 5. Education (cities and municipalities)
  if (location.education_university_pct != null) {
    const uniPct = location.education_university_pct;
    if (uniPct > 25) {
      conclusions.push(`Udio visokoobrazovanih (${uniPct.toFixed(1)}%) znatno je iznad nacionalnog prosjeka (${nationalUniversityPct}%).`);
    } else if (uniPct < 10) {
      conclusions.push(`Udio visokoobrazovanih (${uniPct.toFixed(1)}%) ispod je nacionalnog prosjeka (${nationalUniversityPct}%).`);
    }
  }

  // 6. County-level comparison (for cities/municipalities)
  if (type !== 'zupanija' && location.county_id) {
    const county = zupanije.find(z => z.id === location.county_id);
    if (county) {
      if (pop > county.population_2021 * 0.3) {
        conclusions.push(`${location.name} je najveće urbano središte ${county.name.replace(' županija', 'e županije').replace('Grad Zagreb', 'Grada Zagreba')}, s ${(pop / county.population_2021 * 100).toFixed(0)}% županijskog stanovništva.`);
      }
    }
  }

  // 7. Population size context
  if (type === 'opcina') {
    if (pop < 500) {
      conclusions.push(`S manje od 500 stanovnika, ovo je jedna od najmanjih općina u Hrvatskoj.`);
    } else if (pop > 10000) {
      conclusions.push(`S više od 10.000 stanovnika, ovo je jedna od većih općina u Hrvatskoj.`);
    }
  }
  if (type === 'grad') {
    if (pop > 100000) {
      conclusions.push(`${location.name} je jedan od najvećih gradova u Hrvatskoj.`);
    } else if (pop < 3000) {
      conclusions.push(`S manje od 3.000 stanovnika, ${location.name} je među najmanji gradovima u Hrvatskoj.`);
    }
  }

  return conclusions.slice(0, 5); // Max 5 conclusions
}

// ---------------------------------------------------------------------------
// 5. Main execution
// ---------------------------------------------------------------------------
async function main() {
  const enrichment = {};

  // Step 1: Fetch Wikidata SPARQL
  let wikidataMap = {};
  try {
    const [settlements, counties, cities, municipalities] = await Promise.all([
      fetchSparql(SPARQL_QUERY, 'settlements'),
      fetchSparql(SPARQL_COUNTIES, 'counties'),
      fetchSparql(SPARQL_CITIES, 'cities'),
      fetchSparql(SPARQL_MUNICIPALITIES, 'municipalities'),
    ]);
    console.log(`Wikidata: ${settlements.length} settlement rows, ${counties.length} county rows, ${cities.length} city rows, ${municipalities.length} municipality rows`);

    const allBindings = [...settlements, ...counties, ...cities, ...municipalities];
    wikidataMap = processWikidataResults(allBindings);
    console.log(`Wikidata: ${Object.keys(wikidataMap).length} unique locations matched`);
  } catch (err) {
    console.error('Wikidata SPARQL failed:', err.message);
    console.log('Continuing without Wikidata...');
  }

  // Step 2: Fetch Wikipedia summaries for all locations
  console.log(`\nFetching Wikipedia summaries for ${allLocations.length} locations...`);
  let wikiCount = 0;
  let wikiMiss = 0;

  for (let i = 0; i < allLocations.length; i++) {
    const loc = allLocations[i];
    const slug = loc.slug;
    const wikiTitle = getWikiTitle(loc);

    // Initialize enrichment entry
    enrichment[slug] = {
      description: null,
      thumbnail: null,
      coatOfArms: null,
      photo: null,
      postalCode: null,
      elevation: null,
      officialWebsite: null,
      licensePlate: null,
      sisterCities: [],
      conclusions: [],
    };

    // Match Wikidata by name
    const wdKey = loc.name;
    const wd = wikidataMap[wdKey];
    if (wd) {
      enrichment[slug].coatOfArms = wd.coatOfArms;
      enrichment[slug].photo = wd.photo;
      enrichment[slug].postalCode = wd.postalCode;
      enrichment[slug].elevation = wd.elevation;
      enrichment[slug].officialWebsite = wd.officialWebsite;
      enrichment[slug].licensePlate = wd.licensePlate;
      enrichment[slug].sisterCities = wd.sisterCities || [];
    }

    // Also try matching county names (Wikidata may use different name form)
    if (!wd && loc.type === 'zupanija') {
      // Try without "županija" suffix
      const shortName = loc.name.replace(' županija', '').replace('Grad ', '');
      const wd2 = wikidataMap[shortName] || wikidataMap[loc.name];
      if (wd2) {
        enrichment[slug].coatOfArms = wd2.coatOfArms;
        enrichment[slug].photo = wd2.photo;
        enrichment[slug].postalCode = wd2.postalCode;
        enrichment[slug].elevation = wd2.elevation;
        enrichment[slug].officialWebsite = wd2.officialWebsite;
        enrichment[slug].licensePlate = wd2.licensePlate;
        enrichment[slug].sisterCities = wd2.sisterCities || [];
      }
    }

    // Fetch Wikipedia summary
    const wiki = await fetchWikipediaSummary(wikiTitle);
    if (wiki) {
      enrichment[slug].description = wiki.description;
      if (wiki.thumbnail && !enrichment[slug].photo) {
        enrichment[slug].thumbnail = wiki.thumbnail;
      } else {
        enrichment[slug].thumbnail = wiki.thumbnail;
      }
      wikiCount++;
    } else {
      wikiMiss++;
      // Try alternate titles for municipalities
      if (loc.type === 'opcina') {
        const altTitle = `${loc.name} (općina)`;
        const wiki2 = await fetchWikipediaSummary(altTitle);
        if (wiki2) {
          enrichment[slug].description = wiki2.description;
          enrichment[slug].thumbnail = wiki2.thumbnail;
          wikiCount++;
          wikiMiss--;
        }
        await sleep(50);
      }
      // Try alternate for cities
      if (loc.type === 'grad' && !enrichment[slug].description) {
        const altTitle = `${loc.name} (grad)`;
        const wiki2 = await fetchWikipediaSummary(altTitle);
        if (wiki2) {
          enrichment[slug].description = wiki2.description;
          enrichment[slug].thumbnail = wiki2.thumbnail;
          wikiCount++;
          wikiMiss--;
        }
        await sleep(50);
      }
    }

    // Generate analytical conclusions
    enrichment[slug].conclusions = generateConclusions(loc, loc.type, zupanije, gradovi, opcine);

    // Progress logging
    if ((i + 1) % 50 === 0 || i === allLocations.length - 1) {
      console.log(`  Progress: ${i + 1}/${allLocations.length} (${wikiCount} wiki hits, ${wikiMiss} misses)`);
    }

    // Rate limit Wikipedia API
    await sleep(100);
  }

  // Clean up: remove null/empty fields to keep JSON compact
  for (const slug of Object.keys(enrichment)) {
    const e = enrichment[slug];
    if (e.sisterCities && e.sisterCities.length === 0) delete e.sisterCities;
    if (!e.coatOfArms) delete e.coatOfArms;
    if (!e.photo) delete e.photo;
    if (!e.thumbnail) delete e.thumbnail;
    if (!e.postalCode) delete e.postalCode;
    if (e.elevation == null) delete e.elevation;
    if (!e.officialWebsite) delete e.officialWebsite;
    if (!e.licensePlate) delete e.licensePlate;
    if (!e.description) delete e.description;
    if (e.conclusions && e.conclusions.length === 0) delete e.conclusions;
  }

  // Write output
  const outPath = path.join(ROOT, 'src/data/wiki-enrichment.json');
  fs.writeFileSync(outPath, JSON.stringify(enrichment, null, 2), 'utf-8');
  const stats = {
    total: Object.keys(enrichment).length,
    withDescription: Object.values(enrichment).filter(e => e.description).length,
    withCoatOfArms: Object.values(enrichment).filter(e => e.coatOfArms).length,
    withPhoto: Object.values(enrichment).filter(e => e.photo || e.thumbnail).length,
    withConclusions: Object.values(enrichment).filter(e => e.conclusions?.length > 0).length,
    withPostalCode: Object.values(enrichment).filter(e => e.postalCode).length,
    withWebsite: Object.values(enrichment).filter(e => e.officialWebsite).length,
  };

  console.log(`\n=== Results ===`);
  console.log(`Total locations: ${stats.total}`);
  console.log(`With description: ${stats.withDescription}`);
  console.log(`With coat of arms: ${stats.withCoatOfArms}`);
  console.log(`With photo/thumbnail: ${stats.withPhoto}`);
  console.log(`With conclusions: ${stats.withConclusions}`);
  console.log(`With postal code: ${stats.withPostalCode}`);
  console.log(`With website: ${stats.withWebsite}`);
  console.log(`\nOutput: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
