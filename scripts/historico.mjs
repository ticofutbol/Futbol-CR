// Descarga una sola vez los resultados de torneos viejos (2006-07 a 2025-26) que ESPN todavía tiene,
// y los guarda en public/historico/ para que la pestaña Historia los cargue al elegirlos.
// ESPN ya no tiene los goles de esos partidos: solo marcadores.
//
// Uso:  node scripts/historico.mjs [desde] [hasta]     (por defecto 2006 y 2025, años en que empieza cada temporada)
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/crc.1';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/crc.1/standings';
const OUT = new URL('../public/historico/', import.meta.url);
const [from = 2006, to = 2025] = process.argv.slice(2).map(Number);

async function getJson(url) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// ESPN nombra las etapas de muchas formas: "Torneo de Invierno 2012", "Verano - Semi-finals", "Clausura - Playoff Finals"...
const HALF = [[/invierno/i, 'Invierno', 0], [/verano/i, 'Verano', 1], [/apertura/i, 'Apertura', 0], [/clausura/i, 'Clausura', 1]];
const STAGES = [[/relegation|descenso/i, 'Repechaje'], [/quarter/i, 'Cuartos de final'], [/cuadrangular/i, 'Cuadrangular'], [/semi/i, 'Semifinal'], [/final/i, 'Final']];
function tournamentOf(typeName, seasonYear) {
  const half = HALF.find(([re]) => re.test(typeName));
  if (!half) return null;
  const stage = typeName.includes(' - ') || /relegation/i.test(typeName) ? (STAGES.find(([re]) => re.test(typeName))?.[1] ?? 'Fase final') : null;
  return { name: `${half[1]} ${seasonYear + half[2]}`, stage };
}

// Todos los equipos que aparecen en alguna tabla desde `from` (ESPN no da la lista de equipos de años viejos).
const teamIds = new Set();
for (let y = from; y <= to; y++) {
  for (const q of ['', '&seasontype=1', '&seasontype=6']) {
    const j = await getJson(`${STANDINGS}?season=${y}${q}`).catch(() => null);
    for (const g of j?.children ?? []) for (const e of g.standings?.entries ?? []) teamIds.add(e.team.id);
  }
}
console.log(`${teamIds.size} equipos encontrados en las tablas ${from}-${to}`);

const champions = JSON.parse(await readFile(new URL('../data/campeones.json', import.meta.url), 'utf8')).campeones;
const index = [];
await mkdir(OUT, { recursive: true });
for (let y = from; y <= to; y++) {
  const schedules = await mapLimit([...teamIds], 6, id => getJson(`${SITE}/teams/${id}/schedule?season=${y}`).catch(() => ({ events: [] })));
  const events = new Map();
  for (const s of schedules) for (const ev of s.events ?? []) events.set(ev.id, ev);
  const byTournament = new Map();
  for (const ev of events.values()) {
    const t = tournamentOf(ev.seasonType?.name ?? '', y);
    const c = ev.competitions?.[0];
    const side = h => c?.competitors?.find(x => x.homeAway === h);
    const [home, away] = [side('home'), side('away')];
    if (!t || !home || !away || home.score == null || away.score == null) continue;
    const score = x => Number(x.score?.displayValue ?? x.score?.value ?? x.score);
    if (!byTournament.has(t.name)) byTournament.set(t.name, []);
    byTournament.get(t.name).push({
      d: new Date(new Date(ev.date) - 6 * 3600e3).toISOString().slice(0, 10), // fecha en Costa Rica
      ...(t.stage && { s: t.stage }),
      h: home.team.displayName, a: away.team.displayName,
      hs: score(home), as: score(away),
    });
  }
  for (const [name, matches] of byTournament) {
    matches.sort((a, b) => a.d.localeCompare(b.d));
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await writeFile(new URL(`${slug}.json`, OUT), JSON.stringify({ torneo: name, partidos: matches }) + '\n');
    // Hasta 2006-07 hubo un solo campeón por temporada: se muestra en el torneo que la cerró.
    const season = `${y}-${String(y + 1).slice(2)}`;
    const champ = champions.find(c => c.torneo === name) ?? (/2007$/.test(name) && champions.find(c => c.torneo === season));
    index.push({ torneo: name, slug, partidos: matches.length, fin: matches.at(-1).d, ...(champ && { campeon: champ.campeon, subcampeon: champ.subcampeon, goleador: champ.goleador, ...(champ.torneo !== name && { temporada: champ.torneo }) }) });
    console.log(`  ${name}: ${matches.length} partidos${champ ? ` (campeón: ${champ.campeon})` : ''}`);
  }
}
index.sort((a, b) => b.fin.localeCompare(a.fin));
await writeFile(new URL('indice.json', OUT), JSON.stringify({
  _info: 'Resultados de torneos viejos descargados de ESPN una sola vez (scripts/historico.mjs). ESPN ya no tiene los goles de esos partidos.',
  torneos: index,
}, null, 2) + '\n');
console.log(`→ public/historico/ (${index.length} torneos)`);
