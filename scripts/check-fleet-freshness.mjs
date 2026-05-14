#!/usr/bin/env node

// Cross-site freshness monitor.
// Fails (exit 1) if any monitored site's live data is older than MAX_STALE_HOURS.
// The companion workflow opens/updates a tracking issue on failure.

import fs from 'node:fs';

const SITES = [
  { name: 'mojhoroskop',  url: 'https://mojhoroskop.com.hr/data/today.json',          dateField: 'date' },
  { name: 'hnl',          url: 'https://hnl.com.hr/data/standings.json',              dateField: 'updated' },
  { name: 'mojaprognoza', url: 'https://mojaprognoza.com.hr/data/today.json',         dateField: 'date' },
  { name: 'infodanas',    url: 'https://infodanas.com.hr/data/weather.json',          dateField: 'date' },
  // TODO: switch to https://horoscopomeu.com/data/today.json once apex DNS is configured.
  // The custom domain isn't set up yet so the site only serves from .pages.dev.
  { name: 'horoscopomeu', url: 'https://horoscopomeu-com.pages.dev/data/today.json',  dateField: 'date' },
];

const MAX_STALE_HOURS = Number(process.env.MAX_STALE_HOURS || 48);

function ageHoursFromDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return null;
  const generatedAt = new Date(`${dateString}T12:00:00Z`);
  return (Date.now() - generatedAt.getTime()) / 36e5;
}

const stale = [];

for (const site of SITES) {
  try {
    const res = await fetch(site.url, { headers: { 'User-Agent': 'fleet-freshness/1.0' } });
    if (!res.ok) {
      stale.push({ name: site.name, reason: `HTTP ${res.status} from ${site.url}` });
      console.error(`✗ ${site.name}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    const dateValue = data[site.dateField];
    const ageH = ageHoursFromDate(dateValue);
    if (ageH === null) {
      stale.push({ name: site.name, reason: `bad ${site.dateField} field: ${JSON.stringify(dateValue)}` });
      console.error(`✗ ${site.name}: bad ${site.dateField} field`);
      continue;
    }
    if (ageH > MAX_STALE_HOURS) {
      stale.push({ name: site.name, reason: `data dated ${dateValue} is ${ageH.toFixed(1)}h old (max ${MAX_STALE_HOURS}h)` });
      console.error(`✗ ${site.name}: ${dateValue}, ${ageH.toFixed(1)}h old`);
      continue;
    }
    console.log(`✓ ${site.name}: ${dateValue} (${ageH.toFixed(1)}h old)`);
  } catch (err) {
    stale.push({ name: site.name, reason: `fetch error: ${err.message}` });
    console.error(`✗ ${site.name}: ${err.message}`);
  }
}

if (stale.length > 0) {
  console.error(`\n--- ${stale.length} stale site(s) ---`);
  for (const s of stale) console.error(`- ${s.name}: ${s.reason}`);

  if (process.env.GITHUB_OUTPUT) {
    const lines = stale.map(s => `- **${s.name}** — ${s.reason}`).join('\n');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `stale<<FRESHNESS_EOF\n${lines}\nFRESHNESS_EOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${stale.length}\n`);
  }
  process.exit(1);
}

console.log(`\nAll ${SITES.length} sites fresh.`);
