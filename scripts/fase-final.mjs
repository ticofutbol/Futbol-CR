// Fase final (semifinales y final de ida y vuelta) y tabla acumulada (Apertura + Clausura).
// Funciones puras: update.mjs les pasa los datos ya descargados de ESPN.

// ESPN marca la etapa de cada partido: "apertura", "Apertura - Playoff Semifinals", "clausura---playoff-finals"...
export function phaseOf(text = '') {
  return {
    tournament: /clausura/i.test(text) ? 'Clausura' : 'Apertura',
    stage: /semifinal/i.test(text) ? 'semifinal' : /final/i.test(text) ? 'final' : 'regular',
  };
}

// La temporada va de julio a mayo y ESPN la nombra por el año en que empieza (2026 = Apertura 2026 + Clausura 2027).
export function seasonYear(now = new Date()) {
  const cr = new Date(now.getTime() - 6 * 3600e3); // hora de Costa Rica
  return cr.getUTCMonth() >= 6 ? cr.getUTCFullYear() : cr.getUTCFullYear() - 1;
}

// Torneo en curso: el del último partido jugado, salvo que en menos de una semana empiece uno de otro torneo.
export function currentTournament(played, upcoming, now = Date.now()) {
  const soon = upcoming.find(m => new Date(m.date) - now < 7 * 864e5);
  return soon?.tournament ?? played[0]?.tournament ?? 'Apertura';
}

// Llaves de la fase final. Antes de que empiece, se proyectan con la tabla actual: 1.º vs 4.º y 2.º vs 3.º.
export function buildPlayoffs(matches, standingsRows = []) {
  const seed = new Map(standingsRows.map((r, i) => [r.id, i + 1]));
  const teamOf = new Map(standingsRows.map(r => [r.id, r]));
  const series = new Map();
  for (const m of matches.filter(m => m.stage !== 'regular').sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `${m.stage}:${[m.home.id, m.away.id].sort().join('-')}`;
    if (!series.has(key)) series.set(key, { stage: m.stage, legs: [] });
    series.get(key).legs.push(m);
  }
  const toSeries = ({ stage, legs }) => {
    // El mejor ubicado de la fase regular va primero (y cierra de local).
    const ids = [legs[0].home.id, legs[0].away.id].sort((a, b) => (seed.get(a) ?? 99) - (seed.get(b) ?? 99));
    const goalsFor = id => legs.filter(l => l.completed).reduce((n, l) => n + Number(l.home.id === id ? l.home.score : l.away.score), 0);
    const done = legs.length >= 2 && legs.every(l => l.completed);
    // El ganador lo da ESPN (resuelve empates en el global); si no viene, se usa el global.
    const espnWinner = legs.map(l => l.seriesWinner).find(Boolean) ?? null;
    const [a, b] = ids.map(goalsFor);
    const winner = espnWinner ?? (done && a !== b ? (a > b ? ids[0] : ids[1]) : null);
    return {
      stage,
      teams: ids.map((id, i) => {
        const side = legs[0].home.id === id ? legs[0].home : legs[0].away;
        return { id, name: side.name, short: side.short, abbr: side.abbr, logo: side.logo, seed: seed.get(id) ?? null, aggregate: [a, b][i] };
      }),
      // ESPN no siempre dice cuál es la ida: se numeran por fecha.
      legs: legs.map((l, i) => ({ id: l.id, date: l.date, state: l.state, completed: l.completed, leg: l.leg ?? i + 1, home: l.home.id, away: l.away.id, homeScore: l.home.score, awayScore: l.away.score })),
      winner,
    };
  };
  const all = [...series.values()].map(toSeries);
  const semis = all.filter(s => s.stage === 'semifinal').sort((x, y) => (x.teams[0].seed ?? 99) - (y.teams[0].seed ?? 99));
  const final = all.find(s => s.stage === 'final') ?? null;
  if (semis.length || final) return { projected: false, semis, final };
  const pick = n => { const r = standingsRows[n - 1]; return r && { id: r.id, name: r.name, short: r.short, abbr: r.abbr, logo: teamOf.get(r.id)?.logo, seed: n, aggregate: null }; };
  return {
    projected: true,
    semis: [[1, 4], [2, 3]].map(([x, y]) => ({ stage: 'semifinal', teams: [pick(x), pick(y)].filter(Boolean), legs: [], winner: null })),
    final: null,
  };
}

// Tabla acumulada: suma las tablas oficiales del Apertura y el Clausura (así incluye los puntos ganados en la mesa).
export function accumulatedTable(apertura = [], clausura = []) {
  const rows = new Map();
  for (const [name, table] of [['apertura', apertura], ['clausura', clausura]]) for (const r of table) {
    const row = rows.get(r.id) ?? { id: r.id, name: r.name, short: r.short, abbr: r.abbr, logo: r.logo, apertura: 0, clausura: 0, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 };
    row[name] = r.pts;
    for (const k of ['pj', 'g', 'e', 'p', 'gf', 'gc', 'dg', 'pts']) row[k] += r[k];
    rows.set(r.id, row);
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.name.localeCompare(b.name, 'es'));
}
