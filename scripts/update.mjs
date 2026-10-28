// Descarga los datos de ESPN, los guarda en data/data.json y genera public/index.html.
// Cada sección se descarga por separado: si una falla, se reutiliza la versión guardada.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { render } from './render.mjs';

const ROOT = new URL('../', import.meta.url);
const DATA_FILE = new URL('data/data.json', ROOT);
const GOALS_CACHE = new URL('data/goals-cache.json', ROOT);

const LEAGUE = 'crc.1';
const SITE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}`;
const STANDINGS_URL = `https://site.api.espn.com/apis/v2/sports/soccer/${LEAGUE}/standings`;
const RECENT_COUNT = 10;    // 2 jornadas de 5 partidos (10 equipos)
const UPCOMING_COUNT = 10;
const UPCOMING_DAYS = 35;

async function getJson(url, tries = 2) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

// Ejecuta fn sobre items con un máximo de `limit` peticiones simultáneas.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

async function writeJson(url, value) {
  const tmp = new URL(url.href + '.tmp');
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, url);
}

const statValue = (stats, name) => stats.find(s => s.name === name)?.value ?? 0;
const scoreOf = s => (s && typeof s === 'object' ? (s.displayValue ?? s.value) : s) ?? null;

function team(t) {
  return {
    id: t.id,
    name: t.displayName,
    short: t.shortDisplayName ?? t.displayName,
    abbr: t.abbreviation,
    logo: t.logo ?? t.logos?.[0]?.href ?? null,
  };
}

function match(ev) {
  const c = ev.competitions[0];
  const side = homeAway => {
    const x = c.competitors.find(k => k.homeAway === homeAway);
    return { ...team(x.team), score: scoreOf(x.score) };
  };
  const status = c.status?.type ?? ev.status?.type ?? {};
  return {
    id: ev.id,
    date: ev.date,
    state: status.state,                // pre | in | post
    completed: !!status.completed,
    statusText: status.shortDetail ?? status.description ?? '',
    venue: c.venue?.fullName ?? null,
    home: side('home'),
    away: side('away'),
  };
}

async function fetchStandings() {
  const json = await getJson(STANDINGS_URL);
  const group = json.children?.[0];
  if (!group?.standings?.entries?.length) throw new Error('Tabla vacía');
  const rows = group.standings.entries.map(e => ({
    ...team(e.team),
    rank: statValue(e.stats, 'rank'),
    pj: statValue(e.stats, 'gamesPlayed'),
    g: statValue(e.stats, 'wins'),
    e: statValue(e.stats, 'ties'),
    p: statValue(e.stats, 'losses'),
    gf: statValue(e.stats, 'pointsFor'),
    gc: statValue(e.stats, 'pointsAgainst'),
    dg: statValue(e.stats, 'pointDifferential'),
    pts: statValue(e.stats, 'points'),
  })).sort((a, b) => a.rank - b.rank || b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
  return {
    league: json.name,
    season: group.standings.seasonDisplayName,
    tournament: group.name,
    rows,
  };
}

// Partidos jugados de la temporada: se juntan los calendarios de cada equipo.
async function fetchPlayedMatches(teamIds) {
  const schedules = await mapLimit(teamIds, 5, id => getJson(`${SITE}/teams/${id}/schedule`));
  const byId = new Map();
  for (const s of schedules) for (const ev of s.events ?? []) {
    const m = match(ev);
    if (m.completed) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ESPN no acepta rangos de fechas en el scoreboard de esta liga: se consulta día por día.
async function fetchUpcomingMatches() {
  const days = [];
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 6); // incluye partidos de "hoy" en hora de Costa Rica
  for (let i = 0; i < UPCOMING_DAYS; i++) {
    days.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const boards = await mapLimit(days, 6, day => getJson(`${SITE}/scoreboard?dates=${day}`));
  const byId = new Map();
  for (const b of boards) for (const ev of b.events ?? []) {
    const m = match(ev);
    if (!m.completed) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, UPCOMING_COUNT);
}

// Goleadores: ESPN no publica la tabla, así que se suman los goles del resumen de cada partido.
// Los partidos terminados no cambian, por eso sus goles se guardan en data/goals-cache.json.
async function fetchScorers(played) {
  const cache = await readJson(GOALS_CACHE, {});
  const missing = played.filter(m => !cache[m.id]);
  const failed = [];
  await mapLimit(missing, 6, async m => {
    try {
      const s = await getJson(`${SITE}/summary?event=${m.id}`);
      cache[m.id] = (s.keyEvents ?? [])
        .filter(k => k.scoringPlay)
        .map(k => ({
          player: k.participants?.[0]?.athlete?.displayName ?? 'Desconocido',
          team: k.team?.displayName ?? '',
          type: k.type?.text ?? 'Goal',
        }));
    } catch (err) {
      failed.push(m.id);
    }
  });
  await writeJson(GOALS_CACHE, cache);
  if (failed.length) throw new Error(`No se pudo leer el resumen de ${failed.length} partido(s)`);

  const tally = new Map();
  let total = 0;
  for (const m of played) for (const g of cache[m.id] ?? []) {
    total++;
    if (/own/i.test(g.type)) continue; // los autogoles no cuentan para el goleador
    const key = `${g.player}|${g.team}`;
    const row = tally.get(key) ?? { player: g.player, team: g.team, goals: 0, penalties: 0 };
    row.goals++;
    if (/penalty/i.test(g.type)) row.penalties++;
    tally.set(key, row);
  }
  const rows = [...tally.values()].sort((a, b) => b.goals - a.goals || a.penalties - b.penalties || a.player.localeCompare(b.player));
  const cut = rows[9]?.goals ?? 0; // incluye empatados con el décimo
  return { matchesCounted: played.length, goalsCounted: total, rows: rows.filter((r, i) => i < 10 || r.goals === cut).slice(0, 15) };
}

async function section(name, prev, fn, warnings) {
  try {
    const data = await fn();
    console.log(`✓ ${name}`);
    return { ...data, updatedAt: new Date().toISOString(), stale: false };
  } catch (err) {
    console.warn(`✗ ${name}: ${err.message}`);
    if (prev) {
      warnings.push(`${name}: la fuente falló, se muestran los datos guardados.`);
      return { ...prev, stale: true };
    }
    warnings.push(`${name}: la fuente falló y no hay datos guardados.`);
    return null;
  }
}

async function main() {
  await mkdir(new URL('data/', ROOT), { recursive: true });
  const prev = await readJson(DATA_FILE, {});
  const history = await readJson(new URL('data/history.json', ROOT), { clubs: [] });
  const warnings = [];

  const standings = await section('Tabla de posiciones', prev.standings, fetchStandings, warnings);
  const teamIds = standings?.rows.map(r => r.id) ?? [];

  let played = null;
  const results = await section('Últimos resultados', prev.results, async () => {
    if (!teamIds.length) throw new Error('Sin lista de equipos');
    played = await fetchPlayedMatches(teamIds);
    return { matches: played.slice(0, RECENT_COUNT) };
  }, warnings);

  const upcoming = await section('Próximos partidos', prev.upcoming, async () => ({ matches: await fetchUpcomingMatches() }), warnings);

  const scorers = await section('Goleadores', prev.scorers, async () => {
    if (!played) throw new Error('Sin lista de partidos jugados');
    return fetchScorers(played);
  }, warnings);

  const data = {
    source: 'ESPN (site.api.espn.com, liga crc.1)',
    generatedAt: new Date().toISOString(),
    lastSuccessAt: [standings, results, upcoming, scorers].some(s => s && !s.stale)
      ? new Date().toISOString()
      : prev.lastSuccessAt ?? null,
    warnings,
    standings,
    results,
    upcoming,
    scorers,
    history,
  };

  await writeJson(DATA_FILE, data);
  console.log('→ data/data.json');
  await render(data);
  console.log('→ public/index.html');
  if (warnings.length) console.warn(`\n${warnings.length} aviso(s):\n- ${warnings.join('\n- ')}`);
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exitCode = 1;
});
