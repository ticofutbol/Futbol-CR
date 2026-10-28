// Genera public/index.html (página estática, sin dependencias) a partir de data/data.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const TZ = 'America/Costa_Rica';
const SEMIFINAL_SPOTS = 4;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (iso, opts) => new Intl.DateTimeFormat('es-CR', { timeZone: TZ, ...opts }).format(new Date(iso));
const fmtDateTime = iso => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtStamp = iso => fmt(iso, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const signed = n => (n > 0 ? `+${n}` : String(n));

// Nombre corto, salvo que dos equipos compartan el mismo (p. ej. AD San Carlos e Inter de San Carlos).
let shortCounts = new Map();
const label = t => (shortCounts.get(t.short) ?? 0) > 1 ? t.name : t.short;

const logo = (t, size = 20) => t.logo
  ? `<img class="logo" src="${esc(t.logo)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.visibility='hidden'">`
  : `<span class="logo"></span>`;

function staleNote(sec) {
  if (!sec?.stale) return '';
  const when = sec.updatedAt ? ` del ${esc(fmtStamp(sec.updatedAt))}` : '';
  return `<p class="stale">Datos guardados${when}: la fuente no respondió en la última actualización.</p>`;
}

const empty = msg => `<p class="empty">${esc(msg)}</p>`;

function standingsSection(s) {
  if (!s?.rows?.length) return empty('Tabla no disponible.');
  const rows = s.rows.map((r, i) => `
      <tr class="${i < SEMIFINAL_SPOTS ? 'zone' : ''}">
        <td class="pos">${i + 1}</td>
        <td class="team">${logo(r)}<span class="full">${esc(r.name)}</span><span class="abbr">${esc(r.abbr)}</span></td>
        <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td>
        <td class="opt">${r.gf}</td><td class="opt">${r.gc}</td><td>${signed(r.dg)}</td>
        <td class="pts">${r.pts}</td>
      </tr>`).join('');
  return `
    <div class="table-wrap">
      <table class="standings">
        <thead><tr>
          <th class="pos">#</th><th class="team">Equipo</th>
          <th title="Partidos jugados">PJ</th><th title="Ganados">G</th><th title="Empatados">E</th><th title="Perdidos">P</th>
          <th class="opt" title="Goles a favor">GF</th><th class="opt" title="Goles en contra">GC</th>
          <th title="Diferencia de gol">DG</th><th title="Puntos">Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="legend"><span class="swatch"></span>Zona de semifinales (primeros ${SEMIFINAL_SPOTS})</p>
    ${staleNote(s)}`;
}

function pointsChart(s) {
  if (!s?.rows?.length) return empty('Sin datos para el gráfico.');
  const max = Math.max(...s.rows.map(r => r.pts), 1);
  const bars = s.rows.map((r, i) => `
      <div class="bar-row">
        <span class="bar-label">${esc(label(r))}</span>
        <span class="bar-track"><span class="bar ${i < SEMIFINAL_SPOTS ? 'zone' : ''}" style="width:${(r.pts / max * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${r.pts}</span>
      </div>`).join('');
  return `<div class="bars" role="img" aria-label="Puntos por equipo">${bars}</div>`;
}

function matchList(sec, kind) {
  const list = sec?.matches ?? [];
  if (!list.length) return empty(kind === 'results' ? 'Sin resultados recientes.' : 'No hay partidos programados.');
  const items = list.map(m => {
    const played = kind === 'results';
    const hs = Number(m.home.score), as = Number(m.away.score);
    const win = side => played && (side === 'home' ? hs > as : as > hs) ? ' win' : '';
    const center = played || m.state === 'in'
      ? `<span class="score">${esc(m.home.score)}<span class="dash">–</span>${esc(m.away.score)}</span>`
      : `<span class="vs">vs</span>`;
    return `
      <li class="match">
        <div class="match-meta">${esc(fmtDateTime(m.date))}${m.state === 'in' ? ' · <strong class="live">En vivo</strong>' : ''}${m.venue ? ` · ${esc(m.venue)}` : ''}</div>
        <div class="match-line">
          <span class="side home${win('home')}"><span class="name">${esc(label(m.home))}</span>${logo(m.home, 22)}</span>
          ${center}
          <span class="side away${win('away')}">${logo(m.away, 22)}<span class="name">${esc(label(m.away))}</span></span>
        </div>
      </li>`;
  }).join('');
  return `<ul class="matches">${items}</ul>${staleNote(sec)}`;
}

function scorersSection(s) {
  if (!s?.rows?.length) return empty('Goleadores no disponibles en la fuente.');
  let rank = 0, prevGoals = null;
  const rows = s.rows.map((r, i) => {
    if (r.goals !== prevGoals) { rank = i + 1; prevGoals = r.goals; }
    return `
      <tr>
        <td class="pos">${rank}</td>
        <td class="player">${esc(r.player)}<span class="sub">${esc(r.team)}</span></td>
        <td class="pts">${r.goals}</td>
        <td class="muted">${r.penalties ? `${r.penalties} pen.` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="scorers">
        <thead><tr><th class="pos">#</th><th class="player">Jugador</th><th>Goles</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Calculado a partir de los goles registrados en ${s.matchesCounted} partidos (sin autogoles). Puede diferir levemente del conteo oficial.</p>
    ${staleNote(s)}`;
}

function historySection(h) {
  const clubs = [...(h?.clubs ?? [])].sort((a, b) => b.titles - a.titles);
  if (!clubs.length) return empty('Sin datos históricos.');
  const max = clubs[0].titles;
  const big = clubs.filter(c => c.titles > 1);
  const one = clubs.filter(c => c.titles === 1);
  const bars = big.map(c => `
      <div class="bar-row">
        <span class="bar-label">${esc(c.club)}</span>
        <span class="bar-track"><span class="bar hist" style="width:${(c.titles / max * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${c.titles}</span>
      </div>`).join('');
  return `
    <div class="bars">${bars}</div>
    ${one.length ? `<p class="one-title"><strong>Con 1 título:</strong> ${one.map(c => esc(c.club)).join(', ')}.</p>` : ''}`;
}

export function buildHtml(data) {
  const s = data.standings;
  shortCounts = new Map();
  for (const r of s?.rows ?? []) shortCounts.set(r.short, (shortCounts.get(r.short) ?? 0) + 1);
  const title = `Torneo ${s?.tournament ?? 'Apertura'} ${new Date(data.generatedAt).getFullYear()}`;
  const stamp = data.lastSuccessAt ?? data.generatedAt;
  const warnings = (data.warnings ?? []).length
    ? `<div class="banner" role="status">Algunas fuentes fallaron en la última actualización; se muestran los últimos datos guardados.</div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Fútbol CR</title>
<meta name="description" content="Tabla, resultados, goleadores e historia de la Primera División de Costa Rica.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>">
<script>
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
</script>
<style>
  :root {
    --bg: #f4f5f2; --surface: #ffffff; --surface-2: #eef0ec; --text: #15201a; --muted: #5d6b62;
    --border: #dde2dc; --accent: #0b6e4f; --accent-soft: #dcefe6; --bar: #9aa8a0; --hist: #b5651d;
    --win: #0b6e4f; --warn-bg: #fff4d6; --warn-text: #6b4e00; --live: #c62828;
    --shadow: 0 1px 2px rgb(0 0 0 / .05), 0 2px 8px rgb(0 0 0 / .04);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e1411; --surface: #161e1a; --surface-2: #1d2722; --text: #e6ece8; --muted: #93a39a;
      --border: #2a3530; --accent: #3fbf8f; --accent-soft: #173a2d; --bar: #4e5c55; --hist: #e0954a;
      --win: #3fbf8f; --warn-bg: #3a2f0f; --warn-text: #f3d58a; --live: #ff6b6b; --shadow: none;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0e1411; --surface: #161e1a; --surface-2: #1d2722; --text: #e6ece8; --muted: #93a39a;
    --border: #2a3530; --accent: #3fbf8f; --accent-soft: #173a2d; --bar: #4e5c55; --hist: #e0954a;
    --win: #3fbf8f; --warn-bg: #3a2f0f; --warn-text: #f3d58a; --live: #ff6b6b; --shadow: none;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  header, main, footer { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 20px; padding-bottom: 8px; display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
  h1 { margin: 0; font-size: 1.5rem; letter-spacing: -.01em; }
  .subtitle { margin: 2px 0 0; color: var(--muted); }
  .updated { margin: 6px 0 0; font-size: .85rem; color: var(--muted); }
  .updated time { color: var(--text); font-weight: 600; }
  .theme-btn {
    flex: none; border: 1px solid var(--border); background: var(--surface); color: var(--text);
    border-radius: 999px; padding: 6px 12px; font: inherit; font-size: .85rem; cursor: pointer;
  }
  .banner { margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--warn-bg); color: var(--warn-text); font-size: .9rem; }
  main { display: grid; gap: 16px; grid-template-columns: 1fr; padding-top: 12px; padding-bottom: 24px; }
  @media (min-width: 900px) {
    main { grid-template-columns: 1.4fr 1fr; }
    .span-2 { grid-column: 1 / -1; }
  }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); min-width: 0; }
  .card h2 { margin: 0 0 12px; font-size: 1.05rem; }
  .table-wrap { overflow-x: auto; margin: 0 -4px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 6px; text-align: center; white-space: nowrap; }
  th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
  tbody tr + tr td { border-top: 1px solid var(--border); }
  td.team, th.team, td.player, th.player { text-align: left; }
  td.team { display: flex; align-items: center; gap: 8px; font-weight: 500; }
  td.pos { color: var(--muted); width: 2em; }
  td.pts { font-weight: 700; }
  tr.zone td { background: var(--accent-soft); }
  tr.zone td.pos { color: var(--accent); font-weight: 700; box-shadow: inset 3px 0 0 var(--accent); }
  .abbr { display: none; }
  .logo { width: 20px; height: 20px; object-fit: contain; flex: none; display: inline-block; }
  .legend, .note, .one-title { margin: 10px 0 0; font-size: .85rem; color: var(--muted); }
  .one-title { color: var(--text); }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); vertical-align: -1px; margin-right: 6px; }
  .stale { margin: 10px 0 0; font-size: .8rem; color: var(--warn-text); background: var(--warn-bg); padding: 6px 10px; border-radius: 8px; }
  .empty { color: var(--muted); margin: 0; }
  .muted { color: var(--muted); font-size: .8rem; }
  .sub { display: block; font-size: .8rem; color: var(--muted); }
  .bars { display: grid; gap: 8px; }
  .bar-row { display: grid; grid-template-columns: minmax(90px, 9.5em) 1fr 2.2em; gap: 10px; align-items: center; font-size: .9rem; }
  .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 14px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--bar); border-radius: 4px; }
  .bar.zone { background: var(--accent); }
  .bar.hist { background: var(--hist); }
  .bar-value { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .matches { list-style: none; margin: 0; padding: 0; }
  .match { padding: 10px 0; }
  .match + .match { border-top: 1px solid var(--border); }
  .match-meta { font-size: .78rem; color: var(--muted); margin-bottom: 4px; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match-line { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
  .side { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .side.home { justify-content: flex-end; text-align: right; }
  .side .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side.win .name { font-weight: 700; color: var(--win); }
  .score { font-weight: 700; font-size: 1.05rem; font-variant-numeric: tabular-nums; background: var(--surface-2); padding: 2px 10px; border-radius: 8px; }
  .dash { margin: 0 4px; color: var(--muted); }
  .vs { font-size: .8rem; color: var(--muted); padding: 0 12px; }
  .live { color: var(--live); }
  footer { padding-bottom: 28px; font-size: .8rem; color: var(--muted); }
  @media (max-width: 520px) {
    h1 { font-size: 1.25rem; }
    .full { display: none; }
    .abbr { display: inline; }
    .opt { display: none; }
    th, td { padding: 8px 4px; }
    .card { padding: 14px 12px; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Primera División de Costa Rica</h1>
    <p class="subtitle">${esc(title)}</p>
    <p class="updated">Última actualización: <time datetime="${esc(stamp)}">${esc(fmtStamp(stamp))}</time> (hora de Costa Rica)</p>
  </div>
  <button class="theme-btn" type="button" id="theme-btn" aria-label="Cambiar tema">Tema</button>
</header>
<main>
  ${warnings ? `<div class="span-2">${warnings}</div>` : ''}
  <section class="card"><h2>Tabla de posiciones</h2>${standingsSection(s)}</section>
  <section class="card"><h2>Puntos por equipo</h2>${pointsChart(s)}</section>
  <section class="card"><h2>Últimos resultados</h2>${matchList(data.results, 'results')}</section>
  <section class="card"><h2>Próximos partidos</h2>${matchList(data.upcoming, 'upcoming')}</section>
  <section class="card"><h2>Goleadores</h2>${scorersSection(data.scorers)}</section>
  <section class="card"><h2>${esc(data.history?.title ?? 'Historia')}</h2>${historySection(data.history)}</section>
</main>
<footer>Fuente: ${esc(data.source)}. Página generada el ${esc(fmtStamp(data.generatedAt))}.</footer>
<script>
  (function () {
    var root = document.documentElement, btn = document.getElementById('theme-btn');
    function current() {
      return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    function label() { btn.textContent = current() === 'dark' ? '☀︎ Claro' : '☾ Oscuro'; }
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      label();
    });
    label();
  })();
</script>
</body>
</html>
`;
}

export async function render(data) {
  await mkdir(new URL('public/', ROOT), { recursive: true });
  await writeFile(new URL('public/index.html', ROOT), buildHtml(data), 'utf8');
}

// Uso directo: `npm run render` regenera el HTML desde data/data.json sin descargar nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(await readFile(new URL('data/data.json', ROOT), 'utf8'));
  await render(data);
  console.log('→ public/index.html');
}
