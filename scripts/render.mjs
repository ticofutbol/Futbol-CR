// Genera public/index.html (página estática, sin dependencias) a partir de data/data.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildIcs } from './calendar.mjs';

const ROOT = new URL('../', import.meta.url);
const TZ = 'America/Costa_Rica';
const SEMIFINAL_SPOTS = 4;
const PAGE_URL = 'https://ticofutbol.github.io/Futbol-CR/';
const OG_TITLE = 'Primera División de Costa Rica ⚽ Fútbol CR';
const OG_VERSION = 1; // súbelo si cambias public/og.jpg, para que WhatsApp no use la imagen vieja
// Pestañas: [id, nombre, ícono SVG]. El id es el #hash del link.
const TABS = [
  ['inicio', 'Inicio', '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['tabla', 'Tabla', '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M9 3v18"/>'],
  ['goleadores', 'Goleadores', '<circle cx="12" cy="12" r="9"/><path d="m12 7 3.5 2.5-1.3 4h-4.4l-1.3-4z"/><path d="M12 3v4M20.5 9.5l-5 0M17 19.5l-2.8-6M7 19.5l2.8-6M3.5 9.5l5 0"/>'],
  ['plantillas', 'Plantillas', '<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>'],
  ['historia', 'Historia', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'],
];
// Cada #hash (pestaña o sección) apunta a la pestaña que lo contiene; incluye los links viejos de antes de las pestañas.
const TAB_OF = {
  ...Object.fromEntries(TABS.map(([id]) => [id, id])),
  zona: 'inicio', resultados: 'inicio', proximos: 'inicio', envivo: 'inicio',
  posiciones: 'tabla', puntos: 'tabla', top10: 'goleadores', asistencias: 'goleadores', jugadores: 'plantillas', palmares: 'historia',
};
const SHARE_TEXT ='Tabla, resultados, goleadores y plantillas de la Primera División de Costa Rica 🇨🇷⚽';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (iso, opts) => new Intl.DateTimeFormat('es-CR', { timeZone: TZ, ...opts }).format(new Date(iso));
const fmtDateTime = iso => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtStamp = iso => fmt(iso, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtShort = iso => fmt(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const signed = n => (n > 0 ? `+${n}` : String(n));

// Nombre corto, salvo que dos equipos compartan el mismo (p. ej. AD San Carlos e Inter de San Carlos).
let shortCounts = new Map();
const label = t => (shortCounts.get(t.short) ?? 0) > 1 ? t.name : t.short;

const logo = (t, size = 20, cls = 'logo') => t?.logo
  ? `<img class="${cls}" src="${esc(t.logo)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.visibility='hidden'">`
  : `<span class="${cls}" style="width:${size}px;height:${size}px"></span>`;

function staleNote(sec) {
  if (!sec?.stale) return '';
  const when = sec.updatedAt ? ` del ${esc(fmtStamp(sec.updatedAt))}` : '';
  return `<p class="stale">Datos guardados${when}: la fuente no respondió en la última actualización.</p>`;
}

const empty = msg => `<p class="empty">${esc(msg)}</p>`;

const sectionHead = (id, kicker, title) =>
  `<div class="sec-head" id="${id}"><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2></div>`;

const formPills = (form = []) => form.length
  ? `<span class="form" aria-label="Últimos resultados: ${form.join(', ')}">${form.map(f => `<i class="f-${f}">${f}</i>`).join('')}</span>`
  : '';

/* ---------- Tarjetas destacadas ---------- */

function kpis(data, teamsByName) {
  const s = data.standings, sc = data.scorers, st = data.results?.stats, next = data.upcoming?.matches?.[0];
  const cards = [];
  const leader = s?.rows?.[0];
  if (leader) cards.push(`
    <div class="kpi kpi-leader">
      <span class="kpi-label">Líder</span>
      <div class="kpi-main">${logo(leader, 44, 'kpi-logo')}<div><strong class="kpi-name">${esc(leader.name)}</strong>
      <span class="kpi-sub">${signed(leader.dg)} DG · ${leader.g}G ${leader.e}E ${leader.p}P</span></div></div>
      <span class="kpi-big">${leader.pts}<small>pts</small></span>
    </div>`);
  const top = sc?.rows?.[0];
  if (top) {
    const tied = sc.rows.filter(r => r.goals === top.goals).length;
    cards.push(`
    <div class="kpi">
      <span class="kpi-label">Goleador</span>
      <div class="kpi-main">${logo(teamsByName.get(top.team), 44, 'kpi-logo')}<div><strong class="kpi-name">${esc(top.player)}</strong>
      <span class="kpi-sub">${esc(top.team)}${tied > 1 ? ` · empatado con ${tied - 1} más` : ''}</span></div></div>
      <span class="kpi-big">${top.goals}<small>goles</small></span>
    </div>`);
  }
  if (st?.matches) {
    const b = st.biggest;
    cards.push(`
    <div class="kpi">
      <span class="kpi-label">Goles del torneo</span>
      <div class="kpi-main"><div><strong class="kpi-name">${(st.goals / st.matches).toFixed(2)} por partido</strong>
      <span class="kpi-sub">${st.matches} partidos jugados${b ? ` · Mayor goleada: ${esc(label(b.home))} ${esc(b.home.score)}–${esc(b.away.score)} ${esc(label(b.away))}` : ''}</span></div></div>
      <span class="kpi-big">${st.goals}<small>goles</small></span>
    </div>`);
  }
  if (next) cards.push(`
    <div class="kpi kpi-next">
      <span class="kpi-label">Próximo partido</span>
      <div class="vs-row">
        <span class="vs-team">${logo(next.home, 44, 'kpi-logo')}<b>${esc(label(next.home))}</b></span>
        <span class="vs-mid">VS</span>
        <span class="vs-team">${logo(next.away, 44, 'kpi-logo')}<b>${esc(label(next.away))}</b></span>
      </div>
      <span class="kpi-sub center">${esc(fmtDateTime(next.date))} · <span class="countdown" data-date="${esc(next.date)}"></span></span>
    </div>`);
  return cards.length ? `<section class="kpis">${cards.join('')}</section>` : '';
}

/* ---------- Tabla ---------- */

function standingsSection(s, form) {
  if (!s?.rows?.length) return empty('Tabla no disponible.');
  const rows = s.rows.map((r, i) => `
      <tr class="${i < SEMIFINAL_SPOTS ? 'zone' : ''}">
        <td class="pos"><span class="pos-badge">${i + 1}</span></td>
        <td class="team">${logo(r, 24)}<span class="full">${esc(r.name)}</span><span class="abbr">${esc(r.abbr)}</span></td>
        <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td>
        <td class="opt">${r.gf}</td><td class="opt">${r.gc}</td><td class="dg ${r.dg > 0 ? 'pos-dg' : r.dg < 0 ? 'neg-dg' : ''}">${signed(r.dg)}</td>
        <td class="pts">${r.pts}</td>
        <td class="form-cell">${formPills(form?.[r.id])}</td>
      </tr>`).join('');
  return `
    <div class="table-wrap">
      <table class="standings">
        <thead><tr>
          <th class="pos">#</th><th class="team">Equipo</th>
          <th title="Partidos jugados">PJ</th><th title="Ganados">G</th><th title="Empatados">E</th><th title="Perdidos">P</th>
          <th class="opt" title="Goles a favor">GF</th><th class="opt" title="Goles en contra">GC</th>
          <th title="Diferencia de gol">DG</th><th title="Puntos">Pts</th><th class="form-cell" title="Últimos 5 partidos, del más reciente al más viejo">Racha</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="legend"><span class="swatch"></span>Zona de semifinales · Racha: últimos 5 partidos, el más reciente primero</p>
    ${staleNote(s)}`;
}

// Resumen para la pestaña Inicio: los que hoy están en zona de semifinales.
function miniStandings(s, form) {
  if (!s?.rows?.length) return empty('Tabla no disponible.');
  const rows = s.rows.slice(0, SEMIFINAL_SPOTS).map((r, i) => `
      <li><span class="pos-badge zone-badge">${i + 1}</span>${logo(r, 26)}
        <span class="who"><b>${esc(r.name)}</b><span class="muted">${r.pj} PJ · ${signed(r.dg)} DG</span></span>
        ${formPills(form?.[r.id])}<span class="goals">${r.pts}<small> pts</small></span></li>`).join('');
  const next = s.rows[SEMIFINAL_SPOTS];
  const gap = next ? s.rows[SEMIFINAL_SPOTS - 1].pts - next.pts : null;
  return `
    <ol class="scorer-list mini">${rows}</ol>
    ${next ? `<p class="note">5.º lugar: ${esc(next.name)} con ${next.pts} pts${gap === 0 ? ', igualado en puntos con el 4.º' : `, a ${gap} del 4.º`}.</p>` : ''}
    <a class="more-link" href="#tabla">Ver tabla completa →</a>`;
}

function pointsChart(s) {
  if (!s?.rows?.length) return empty('Sin datos para el gráfico.');
  const max = Math.max(...s.rows.map(r => r.pts), 1);
  const bars = s.rows.map((r, i) => `
      <div class="bar-row" style="--d:${i * 60}ms">
        <span class="bar-label">${logo(r, 20)}<span>${esc(label(r))}</span></span>
        <span class="bar-track"><span class="bar ${i < SEMIFINAL_SPOTS ? 'zone' : ''}" style="width:${(r.pts / max * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${r.pts}</span>
      </div>`).join('');
  return `<div class="bars" role="img" aria-label="Puntos por equipo">${bars}</div>`;
}

/* ---------- Partidos ---------- */

function matchList(sec, kind) {
  const list = sec?.matches ?? [];
  if (!list.length) return empty(kind === 'results' ? 'Sin resultados recientes.' : 'No hay partidos programados.');
  const items = list.map(m => {
    const played = kind === 'results';
    const hs = Number(m.home.score), as = Number(m.away.score);
    const cls = side => !played ? '' : (side === 'home' ? hs > as : as > hs) ? ' win' : hs === as ? ' draw' : ' lose';
    const center = played || m.state === 'in'
      ? `<span class="score${m.state === 'in' ? ' live-score' : ''}">${esc(m.home.score)}<span class="dash">–</span>${esc(m.away.score)}</span>`
      : `<span class="kick">${esc(fmt(m.date, { hour: '2-digit', minute: '2-digit', hour12: false }))}</span>`;
    return `
      <li class="match">
        <div class="match-meta"><span class="date-chip">${esc(fmt(m.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>${m.state === 'in' ? '<strong class="live">● En vivo</strong>' : ''}${m.venue ? `<span class="venue">${esc(m.venue)}</span>` : ''}</div>
        <div class="match-line">
          <span class="side home${cls('home')}"><span class="name">${esc(label(m.home))}</span><span class="name-abbr">${esc(m.home.abbr)}</span>${logo(m.home, 28)}</span>
          ${center}
          <span class="side away${cls('away')}">${logo(m.away, 28)}<span class="name">${esc(label(m.away))}</span><span class="name-abbr">${esc(m.away.abbr)}</span></span>
        </div>
      </li>`;
  }).join('');
  return `<ul class="matches">${items}</ul>${staleNote(sec)}`;
}

function calendarBox() {
  const ics = new URL('partidos.ics', PAGE_URL).href;
  const webcal = ics.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  return `
    <div class="cal-box">
      <div class="cal-text"><strong>📅 Recibe un aviso antes de cada partido</strong>
        <span>Agrega el calendario a tu celular una sola vez; los partidos nuevos y los cambios de horario se actualizan solos.</span></div>
      <div class="cal-actions">
        <a class="btn" href="${esc(google)}" target="_blank" rel="noopener">Google Calendar</a>
        <a class="btn" href="${esc(webcal)}">iPhone / Mac</a>
        <a class="btn ghost" href="partidos.ics" download>Descargar .ics</a>
      </div>
    </div>`;
}

/* ---------- Goleadores ---------- */

function scorersSection(s, teamsByName) {
  if (!s?.rows?.length) return empty('Goleadores no disponibles en la fuente.');
  let rank = 0, prevGoals = null;
  const ranked = s.rows.map((r, i) => {
    if (r.goals !== prevGoals) { rank = i + 1; prevGoals = r.goals; }
    return { ...r, rank };
  });
  const medal = ['gold', 'silver', 'bronze'];
  // La medalla depende del puesto real: si hay empate, comparten el mismo color.
  const podium = ranked.slice(0, 3).map(r => `
      <div class="podium-card ${medal[r.rank - 1] ?? ''}">
        <span class="medal">${r.rank}</span>
        ${logo(teamsByName.get(r.team), 40, 'podium-logo')}
        <strong>${esc(r.player)}</strong>
        <span class="muted">${esc(r.team)}</span>
        <span class="podium-goals">${r.goals}<small> goles${r.penalties ? ` · ${r.penalties} pen.` : ''}</small></span>
      </div>`).join('');
  const rest = ranked.slice(3).map(r => `
      <li><span class="rank">${r.rank}</span>${logo(teamsByName.get(r.team), 22)}
        <span class="who"><b>${esc(r.player)}</b><span class="muted">${esc(r.team)}</span></span>
        <span class="goals">${r.goals}</span></li>`).join('');
  return `
    <div class="podium">${podium}</div>
    <ol class="scorer-list">${rest}</ol>
    <p class="note">Calculado a partir de los goles registrados por ESPN en ${s.matchesCounted} partidos (sin autogoles)${s.corrections ? `, con ${s.corrections} ${s.corrections === 1 ? 'gol corregido' : 'goles corregidos'} a mano según las crónicas de los medios` : ''}. Puede diferir levemente del conteo oficial.</p>
    ${staleNote(s)}`;
}

function assistsSection(a, teamsByName) {
  if (!a?.rows?.length) return empty('Asistencias no disponibles.');
  let rank = 0, prev = null;
  const rows = a.rows.map((r, i) => {
    if (r.assists !== prev) { rank = i + 1; prev = r.assists; }
    return `
      <li><span class="rank">${rank}</span>${logo(teamsByName.get(r.team), 22)}
        <span class="who"><b>${esc(r.player)}</b><span class="muted">${esc(r.team)}</span></span>
        <span class="goals">${r.assists}</span></li>`;
  }).join('');
  const [y, m, d] = a.updated.split('-');
  return `
    <ol class="scorer-list">${rows}</ol>
    <p class="note">ESPN no registra asistencias: estas vienen de ${esc(a.source)} y se cargan a mano (última vez: ${d}/${m}/${y}), así que pueden ir atrasadas respecto a los goles.</p>`;
}

/* ---------- Plantillas ---------- */

const POSITION_NAMES = { G: 'Porteros', D: 'Defensas', M: 'Mediocampistas', F: 'Delanteros' };

// ESPN da los países en inglés; los que se escriben distinto en español.
const COUNTRY_ES = {
  Panama: 'Panamá', Mexico: 'México', USA: 'Estados Unidos', 'United States': 'Estados Unidos',
  Spain: 'España', Brazil: 'Brasil', Peru: 'Perú', Haiti: 'Haití', Canada: 'Canadá',
  'Dominican Republic': 'República Dominicana', 'Trinidad and Tobago': 'Trinidad y Tobago',
  France: 'Francia', Italy: 'Italia', Germany: 'Alemania', England: 'Inglaterra', Netherlands: 'Países Bajos',
};
const country = c => COUNTRY_ES[c] ?? c;

function squadsSection(sq) {
  const teams = sq?.teams ?? [];
  if (!teams.length) return empty('Plantillas no disponibles.');
  const options = teams.map((t, i) => `<option value="${esc(t.id)}"${i === 0 ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const panels = teams.map((t, i) => {
    const groups = Object.entries(POSITION_NAMES).map(([pos, title]) => {
      const players = t.players.filter(p => p.position === pos);
      if (!players.length) return '';
      const rows = players.map(p => `
          <tr>
            <td class="num"><span class="jersey">${esc(p.jersey ?? '–')}</span></td>
            <td class="player">${esc(p.name)}</td>
            <td>${p.age ?? '–'}</td>
            <td class="country">${p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="${esc(country(p.country))}" title="${esc(country(p.country))}" width="20" height="14" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(country(p.country) ?? '–')}</span></td>
            <td class="pts">${p.goals ? `<span class="goal-badge">${p.goals}</span>` : ''}</td>
            <td class="pts">${p.assists ? `<span class="assist-badge">${p.assists}</span>` : ''}</td>
          </tr>`).join('');
      return `
        <tbody>
          <tr class="group"><th colspan="6">${title} <span class="muted">(${players.length})</span></th></tr>
          ${rows}
        </tbody>`;
    }).join('');
    const goals = t.players.reduce((n, p) => n + p.goals, 0);
    const assists = t.players.reduce((n, p) => n + (p.assists ?? 0), 0);
    const ages = t.players.filter(p => p.age).map(p => p.age);
    const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '–';
    const foreign = t.players.filter(p => p.country && p.country !== 'Costa Rica').length;
    return `
      <div class="squad" data-team="${esc(t.id)}"${i === 0 ? '' : ' hidden'}>
        <div class="squad-head">${logo(t, 48, 'squad-logo')}<div><strong>${esc(t.name)}</strong>
          <div class="squad-stats"><span><b>${t.players.length}</b> jugadores</span><span><b>${avgAge}</b> edad prom.</span><span><b>${foreign}</b> extranjeros</span><span><b>${goals}</b> goles</span>${assists ? `<span><b>${assists}</b> asist.</span>` : ''}</div></div></div>
        <div class="table-wrap">
          <table class="squad-table">
            <thead><tr><th class="num">#</th><th class="player">Jugador</th><th>Edad</th><th class="country">Nac.</th><th title="Goles en el torneo">Goles</th><th title="Asistencias (Transfermarkt)">Asist.</th></tr></thead>
            ${groups}
          </table>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="select-wrap"><label class="select-label" for="squad-select">Elige un equipo</label>
    <select id="squad-select" class="select">${options}</select></div>
    ${panels}
    <p class="note">Plantilla inscrita según ESPN. Goles del torneo actual, calculados a partir de los partidos.</p>
    ${staleNote(sq)}`;
}

/* ---------- Historia ---------- */

function historySection(h) {
  const clubs = [...(h?.clubs ?? [])].sort((a, b) => b.titles - a.titles);
  if (!clubs.length) return empty('Sin datos históricos.');
  const max = clubs[0].titles;
  const big3 = clubs.slice(0, 3);
  const mid = clubs.slice(3).filter(c => c.titles > 1);
  const one = clubs.filter(c => c.titles === 1);
  const tiles = big3.map((c, i) => `
      <div class="trophy-tile t${i + 1}">
        <span class="trophy" aria-hidden="true">🏆</span>
        <span class="trophy-count">${c.titles}</span>
        <strong>${esc(c.club)}</strong>
      </div>`).join('');
  const bars = mid.map(c => `
      <div class="bar-row">
        <span class="bar-label"><span>${esc(c.club)}</span></span>
        <span class="bar-track"><span class="bar hist" style="width:${(c.titles / max * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${c.titles}</span>
      </div>`).join('');
  return `
    <div class="trophies">${tiles}</div>
    ${bars ? `<div class="bars hist-bars">${bars}</div>` : ''}
    ${one.length ? `<p class="one-title">Con 1 título</p><div class="chips">${one.map(c => `<span class="chip">${esc(c.club)}</span>`).join('')}</div>` : ''}`;
}

/* ---------- Página ---------- */

const PITCH = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='300' viewBox='0 0 600 300' fill='none' stroke='white' stroke-opacity='.10' stroke-width='2'><rect x='10' y='10' width='580' height='280'/><line x1='300' y1='10' x2='300' y2='290'/><circle cx='300' cy='150' r='50'/><rect x='10' y='80' width='70' height='140'/><rect x='520' y='80' width='70' height='140'/></svg>`);

export function buildHtml(data) {
  const s = data.standings;
  shortCounts = new Map();
  for (const r of s?.rows ?? []) shortCounts.set(r.short, (shortCounts.get(r.short) ?? 0) + 1);
  const teamsByName = new Map((s?.rows ?? []).map(r => [r.name, r]));
  const year = new Date(data.generatedAt).getFullYear();
  const jornada = Math.max(0, ...(s?.rows ?? []).map(r => r.pj));
  const stamp = data.lastSuccessAt ?? data.generatedAt;
  const form = data.results?.form;
  const warnings = (data.warnings ?? []).length
    ? `<div class="banner" role="status">Algunas fuentes fallaron en la última actualización; se muestran los últimos datos guardados.</div>`
    : '';

  // Descripción de la vista previa (WhatsApp, redes): cambia con los datos del día.
  const leader = s?.rows?.[0];
  const top = data.scorers?.rows?.[0];
  const topNames = top ? data.scorers.rows.filter(r => r.goals === top.goals).map(r => r.player) : [];
  const description = [
    leader && `Líder: ${leader.name} (${leader.pts} pts)`,
    top && `Goleo: ${topNames.slice(0, 2).join(', ')}${topNames.length > 2 ? ' y otros' : ''} (${top.goals})`,
    'Tabla, resultados, plantillas y calendario. Se actualiza todos los días.',
  ].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#063d2a">
<title>${esc(OG_TITLE)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${PAGE_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fútbol CR">
<meta property="og:locale" content="es_CR">
<meta property="og:url" content="${PAGE_URL}">
<meta property="og:title" content="${esc(OG_TITLE)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${PAGE_URL}og.jpg?v=${OG_VERSION}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Primera División de Costa Rica: tabla, resultados, goleadores y plantillas">
<meta name="twitter:card" content="summary_large_image">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Fútbol CR">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
  // Se decide la pestaña antes de pintar la página, para que no parpadee.
  var TAB_OF = ${JSON.stringify(TAB_OF)};
  document.documentElement.dataset.tab = TAB_OF[location.hash.slice(1)] || 'inicio';
</script>
<style>
  :root {
    --bg: #eef2ee; --surface: #ffffff; --surface-2: #f1f4f1; --text: #0f1a14; --muted: #5b6b61;
    --border: #dfe6e0; --accent: #0a8a5c; --accent-2: #0fb376; --accent-soft: #dff3ea; --gold: #e0a100;
    --bar: #c3cdc7; --win: #16a34a; --draw: #94a3a0; --loss: #e5484d; --warn-bg: #fff4d6; --warn-text: #6b4e00;
    --live: #e5484d; --shadow: 0 1px 2px rgb(16 40 28 / .06), 0 8px 24px rgb(16 40 28 / .06);
    --hero-1: #04281b; --hero-2: #0a7a52; --display: "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #080d0a; --surface: #111915; --surface-2: #18221d; --text: #e9f0eb; --muted: #8fa198;
      --border: #223029; --accent: #34d399; --accent-2: #10b981; --accent-soft: #10291f; --gold: #fbbf24;
      --bar: #2c3a33; --win: #22c55e; --draw: #6b7c74; --loss: #f87171; --warn-bg: #3a2f0f; --warn-text: #f3d58a;
      --live: #ff6b6b; --shadow: 0 1px 0 rgb(255 255 255 / .03) inset; --hero-1: #02160e; --hero-2: #075c3d;
    }
  }
  :root[data-theme="dark"] {
    --bg: #080d0a; --surface: #111915; --surface-2: #18221d; --text: #e9f0eb; --muted: #8fa198;
    --border: #223029; --accent: #34d399; --accent-2: #10b981; --accent-soft: #10291f; --gold: #fbbf24;
    --bar: #2c3a33; --win: #22c55e; --draw: #6b7c74; --loss: #f87171; --warn-bg: #3a2f0f; --warn-text: #f3d58a;
    --live: #ff6b6b; --shadow: 0 1px 0 rgb(255 255 255 / .03) inset; --hero-1: #02160e; --hero-2: #075c3d;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 64px; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 16px; }

  /* Hero */
  .hero {
    color: #fff; position: relative; overflow: hidden;
    background:
      url("data:image/svg+xml,${PITCH}") center/cover no-repeat,
      radial-gradient(1200px 400px at 85% -10%, rgb(255 255 255 / .14), transparent 60%),
      linear-gradient(135deg, var(--hero-1), var(--hero-2));
    padding: 18px 0 64px;
  }
  .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; opacity: .9; }
  .brand .ball { font-size: 1.1rem; }
  .theme-btn {
    border: 1px solid rgb(255 255 255 / .3); background: rgb(255 255 255 / .1); color: #fff;
    border-radius: 999px; padding: 6px 12px; font: inherit; font-size: .85rem; cursor: pointer; backdrop-filter: blur(6px);
  }
  .theme-btn:hover { background: rgb(255 255 255 / .2); }
  .hero-actions { display: flex; gap: 8px; }
  .share-btn { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; background: #fbbf24; color: #1f1500; border-color: transparent; }
  .share-btn:hover { background: #fcd34d; }
  .toast {
    position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom)); transform: translate(-50%, 20px); opacity: 0;
    background: #0f1a14; color: #fff; padding: 10px 16px; border-radius: 12px; font-size: .9rem; font-weight: 600;
    box-shadow: 0 8px 24px rgb(0 0 0 / .3); transition: opacity .2s, transform .2s; z-index: 50; pointer-events: none; max-width: calc(100% - 32px); text-align: center;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .wa-link { color: var(--accent); font-weight: 600; }
  .eyebrow { margin: 26px 0 0; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; font-size: .8rem; color: #a7f3d0; }
  h1 { margin: 2px 0 0; font-family: var(--display); font-weight: 800; font-size: clamp(2.6rem, 9vw, 4.6rem); line-height: .92; letter-spacing: .01em; text-transform: uppercase; }
  .hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .hchip { background: rgb(255 255 255 / .12); border: 1px solid rgb(255 255 255 / .18); border-radius: 999px; padding: 5px 12px; font-size: .82rem; backdrop-filter: blur(6px); }
  .hchip b { font-weight: 700; }
  .hchip.accent { background: #fbbf24; color: #1f1500; border-color: transparent; font-weight: 700; }

  /* Navegación */
  /* Pestañas: en compu van dentro de la portada; en celular, fijas abajo como en una app. */
  .tabbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 18px; }
  .tab-link { display: inline-flex; align-items: center; gap: 7px; text-decoration: none; color: rgb(255 255 255 / .85); font-weight: 600; font-size: .9rem; padding: 8px 14px; border-radius: 999px; background: rgb(255 255 255 / .08); border: 1px solid rgb(255 255 255 / .14); }
  .tab-link svg { width: 18px; height: 18px; }
  .tab-link:hover { background: rgb(255 255 255 / .16); color: #fff; }
${TABS.map(([id]) => `  html[data-tab="${id}"] .tab-link[data-tab="${id}"] { background: #fff; color: var(--hero-1); border-color: #fff; }
  html[data-tab="${id}"] .panel:not([data-tab="${id}"]) { display: none; }`).join('\n')}
  /* Fuera de Inicio, la portada se achica para dejar más espacio al contenido. */
  html[data-tab]:not([data-tab="inicio"]) .hero { padding-bottom: 20px; }
  html[data-tab]:not([data-tab="inicio"]) .eyebrow { display: none; }
  html[data-tab]:not([data-tab="inicio"]) h1 { font-size: clamp(1.9rem, 6vw, 2.6rem); margin-top: 14px; }
  html[data-tab]:not([data-tab="inicio"]) h1 br { display: none; }
  html[data-tab]:not([data-tab="inicio"]) .hero-chips { margin-top: 10px; }
  @media (max-width: 760px) {
    .tabbar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; margin: 0; gap: 0; flex-wrap: nowrap;
      background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px);
      border-top: 1px solid var(--border); padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    }
    .tab-link { flex: 1; flex-direction: column; gap: 2px; padding: 6px 2px; border: 0; border-radius: 12px; background: none; color: var(--muted); font-size: .68rem; }
    .tab-link svg { width: 22px; height: 22px; }
    .tab-link:hover { background: none; color: var(--text); }
${TABS.map(([id]) => `    html[data-tab="${id}"] .tab-link[data-tab="${id}"] { background: var(--accent-soft); color: var(--accent); }`).join('\n')}
    body { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
    .toast { bottom: calc(84px + env(safe-area-inset-bottom)); }
  }

  .banner { margin: 16px 0 0; padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); color: var(--warn-text); font-size: .9rem; }

  /* Tarjetas destacadas */
  .kpis { display: grid; gap: 12px; grid-template-columns: 1fr; margin-top: -44px; position: relative; z-index: 1; }
  @media (min-width: 640px) { .kpis { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1000px) { .kpis { grid-template-columns: repeat(4, 1fr); } }
  .kpi {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; box-shadow: var(--shadow);
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; row-gap: 10px;
    position: relative; overflow: hidden; min-width: 0;
  }
  .kpi-label, .vs-row, .kpi-sub.center { grid-column: 1 / -1; }
  .kpi::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .kpi-leader::before, .kpi-next::before { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
  .kpi-label { font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .kpi-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .kpi-main > div { min-width: 0; }
  .kpi-logo { width: 44px; height: 44px; object-fit: contain; flex: none; }
  .kpi-name { display: block; font-size: 1rem; line-height: 1.2; overflow-wrap: anywhere; }
  .kpi-sub { display: block; font-size: .8rem; color: var(--muted); }
  .kpi-sub.center { text-align: center; }
  .kpi-big { font-family: var(--display); font-weight: 800; font-size: 2.6rem; line-height: 1; color: var(--accent); text-align: right; }
  .kpi-big small { display: block; font-family: Inter, system-ui, sans-serif; font-size: .68rem; font-weight: 600; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }
  .vs-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6px; text-align: center; }
  .vs-team { display: grid; justify-items: center; gap: 4px; min-width: 0; }
  .vs-team b { font-size: .9rem; line-height: 1.15; overflow-wrap: anywhere; }
  .vs-mid { font-family: var(--display); font-weight: 800; font-size: 1.3rem; color: var(--muted); }
  .countdown { color: var(--accent); font-weight: 700; }

  /* Grilla y tarjetas */
  main.wrap { padding-bottom: 28px; }
  .panel { padding-top: 16px; }
  .grid { display: grid; gap: 16px; grid-template-columns: 1fr; align-items: start; }
  .panel .kpis ~ .grid { margin-top: 16px; }
  /* Inicio en compu: zona y resultados apilados a la izquierda, próximos ocupa toda la columna derecha. */
  @media (min-width: 1000px) {
    .grid.home { grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr; }
    .grid.home > :nth-child(1) { grid-column: 1; grid-row: 1; }
    .grid.home > :nth-child(2) { grid-column: 2; grid-row: 1 / span 2; }
    .grid.home > :nth-child(3) { grid-column: 1; grid-row: 2; }
  }
  @media (min-width: 1180px) { .grid.two-wide { grid-template-columns: 1.45fr 1fr; } }
  .grid.narrow { max-width: 760px; margin: 0 auto; }
  .more-link { display: inline-block; margin-top: 12px; font-weight: 700; color: var(--accent); text-decoration: none; }
  .more-link:hover { text-decoration: underline; }
  .scorer-list.mini { margin-top: 0; }
  .scorer-list.mini .form { margin-right: 4px; }
  .pos-badge.zone-badge { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; flex: none; }
  .goals small { font-family: Inter, system-ui, sans-serif; font-size: .7rem; color: var(--muted); font-weight: 600; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 18px; box-shadow: var(--shadow); min-width: 0; }
  .sec-head { margin: 0 0 14px; }
  .kicker { display: block; font-size: .7rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .sec-head h2 { margin: 0; font-family: var(--display); font-weight: 800; font-size: 1.7rem; line-height: 1.05; text-transform: uppercase; letter-spacing: .01em; }

  /* Tablas */
  .table-wrap { overflow-x: auto; margin: 0 -6px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 9px 6px; text-align: center; white-space: nowrap; }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; border-bottom: 1px solid var(--border); }
  tbody tr + tr td { border-top: 1px solid var(--border); }
  td.team, th.team, td.player, th.player { text-align: left; }
  td.team { display: flex; align-items: center; gap: 10px; font-weight: 600; }
  td.pos { width: 2.4em; }
  .pos-badge { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; font-weight: 700; font-size: .8rem; color: var(--muted); background: var(--surface-2); }
  tr.zone .pos-badge { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; }
  tr.zone td { background: color-mix(in srgb, var(--accent-soft) 70%, transparent); }
  td.pts { font-weight: 800; font-family: var(--display); font-size: 1.15rem; }
  .pos-dg { color: var(--win); font-weight: 600; } .neg-dg { color: var(--loss); font-weight: 600; }
  tbody tr:hover td { background: var(--surface-2); }
  tr.zone:hover td { background: var(--accent-soft); }
  .abbr { display: none; }
  .logo { width: 20px; height: 20px; object-fit: contain; flex: none; display: inline-block; }
  .form { display: inline-flex; gap: 3px; }
  .form i { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; font-style: normal; font-size: .68rem; font-weight: 800; color: #fff; }
  .f-G { background: var(--win); } .f-E { background: var(--draw); } .f-P { background: var(--loss); }
  .legend, .note { margin: 12px 0 0; font-size: .8rem; color: var(--muted); }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 4px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); vertical-align: -1px; margin-right: 6px; }
  .stale { margin: 10px 0 0; font-size: .8rem; color: var(--warn-text); background: var(--warn-bg); padding: 6px 10px; border-radius: 8px; }
  .empty { color: var(--muted); margin: 0; }
  .muted { color: var(--muted); font-size: .8rem; }

  /* Barras */
  .bars { display: grid; gap: 9px; }
  .bar-row { display: grid; grid-template-columns: minmax(110px, 10.5em) 1fr 2.4em; gap: 10px; align-items: center; font-size: .9rem; }
  .bar-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .bar-label span { line-height: 1.15; overflow-wrap: anywhere; }
  .bar-track { height: 16px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--bar); border-radius: 999px; transform-origin: left; animation: grow .9s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
  .bar.zone { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .bar.hist { background: linear-gradient(90deg, #d97706, #fbbf24); }
  .bar-value { text-align: right; font-family: var(--display); font-weight: 800; font-size: 1.15rem; }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @media (prefers-reduced-motion: reduce) { .bar { animation: none; } html { scroll-behavior: auto; } }

  /* Partidos */
  .matches { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .match { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); }
  .match-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: .75rem; color: var(--muted); margin-bottom: 6px; min-width: 0; }
  .date-chip { flex: none; text-transform: capitalize; font-weight: 700; color: var(--text); }
  .venue { min-width: 0; }
  .match-line { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
  .side { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 500; }
  .side.home { justify-content: flex-end; text-align: right; }
  .side .name { line-height: 1.15; overflow-wrap: anywhere; }
  .side.win .name { font-weight: 800; }
  .side.lose .name { color: var(--muted); }
  .score { font-family: var(--display); font-weight: 800; font-size: 1.35rem; font-variant-numeric: tabular-nums; background: var(--surface); border: 1px solid var(--border); padding: 0 12px; border-radius: 10px; min-width: 72px; text-align: center; }
  .live-score { border-color: var(--live); color: var(--live); }
  .dash { margin: 0 4px; color: var(--muted); }
  .kick { font-family: var(--display); font-weight: 700; font-size: 1.1rem; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; padding: 2px 10px; border-radius: 10px; min-width: 72px; text-align: center; }
  .live { color: var(--live); }
  .live-card { margin-top: 16px; border-color: color-mix(in srgb, var(--live) 40%, var(--border)); }
  .live-card .date-chip { text-transform: none; }
  .match.is-live { box-shadow: inset 3px 0 0 var(--live); }
  .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--live); margin-right: 5px; vertical-align: 1px; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  .goal-list { list-style: none; margin: 8px 0 0; padding: 6px 0 0; border-top: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: .8rem; color: var(--muted); }
  .goal-list .g-home { grid-column: 1; text-align: right; }
  .goal-list .g-away { grid-column: 2; }
  .name-abbr { display: none; font-weight: inherit; }
  @media (max-width: 420px) {
    .side .name { display: none; }
    .name-abbr { display: inline; }
  }
  .cal-box { display: grid; gap: 10px; padding: 14px; margin-bottom: 12px; border-radius: 14px; border: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent); background: var(--accent-soft); }
  .cal-text { display: grid; gap: 2px; }
  .cal-text span { font-size: .82rem; color: var(--muted); }
  .cal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; font-weight: 700; font-size: .82rem; padding: 8px 12px; border-radius: 10px; color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  .btn:hover { filter: brightness(1.08); }
  .btn.ghost { background: var(--surface); color: var(--text); border: 1px solid var(--border); }

  /* Goleadores */
  .podium { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-items: end; }
  .podium-card { display: grid; justify-items: center; text-align: center; gap: 4px; padding: 14px 8px; border-radius: 16px; background: var(--surface-2); position: relative; min-width: 0; }
  .podium-card strong { font-size: .88rem; line-height: 1.2; }
  .podium-card .muted { font-size: .72rem; }
  .podium-card.gold { padding-top: 22px; background: linear-gradient(180deg, color-mix(in srgb, #fbbf24 22%, var(--surface-2)), var(--surface-2)); }
  .podium-logo { width: 40px; height: 40px; object-fit: contain; }
  .medal { position: absolute; top: -10px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: .8rem; color: #1b1300; box-shadow: 0 2px 6px rgb(0 0 0 / .2); }
  .gold .medal { background: linear-gradient(135deg, #fde68a, #f59e0b); }
  .silver .medal { background: linear-gradient(135deg, #f1f5f9, #94a3b8); }
  .bronze .medal { background: linear-gradient(135deg, #fed7aa, #c2410c); color: #fff; }
  .podium-goals { font-family: var(--display); font-weight: 800; font-size: 1.9rem; line-height: 1; color: var(--accent); }
  .podium-goals small { font-family: Inter, system-ui, sans-serif; font-size: .7rem; color: var(--muted); font-weight: 600; }
  .scorer-list { list-style: none; margin: 14px 0 0; padding: 0; }
  .scorer-list li { display: flex; align-items: center; gap: 10px; padding: 8px 4px; }
  .scorer-list li + li { border-top: 1px solid var(--border); }
  .rank { width: 1.6em; text-align: center; color: var(--muted); font-weight: 700; }
  .who { display: grid; min-width: 0; flex: 1; }
  .who b { font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
  .goals { font-family: var(--display); font-weight: 800; font-size: 1.2rem; }

  /* Plantillas */
  .select-wrap { display: grid; gap: 4px; max-width: 340px; }
  .select-label { font-size: .75rem; font-weight: 600; color: var(--muted); }
  .select { width: 100%; font: inherit; font-weight: 600; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
  .squad-head { display: flex; align-items: center; gap: 14px; margin: 16px 0 8px; padding: 14px; border-radius: 16px; background: linear-gradient(135deg, var(--accent-soft), transparent); }
  .squad-head strong { font-family: var(--display); font-weight: 800; font-size: 1.5rem; text-transform: uppercase; }
  .squad-logo { width: 48px; height: 48px; object-fit: contain; flex: none; }
  .squad-stats { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .8rem; color: var(--muted); }
  .squad-stats b { color: var(--text); }
  .squad-table td.player { white-space: normal; font-weight: 500; }
  .squad-table td.num, .squad-table th.num { width: 3em; }
  .jersey { display: inline-grid; place-items: center; min-width: 28px; height: 24px; padding: 0 4px; border-radius: 7px; background: var(--surface-2); border: 1px solid var(--border); font-family: var(--display); font-weight: 700; font-size: .95rem; }
  .squad-table td.country, .squad-table th.country { text-align: left; }
  .squad-table td.country span { vertical-align: middle; }
  .flag { width: 20px; height: 14px; object-fit: cover; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .goal-badge { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 999px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-family: var(--display); font-weight: 800; font-size: .95rem; padding: 0 6px; }
  .assist-badge { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 999px; border: 2px solid var(--accent); color: var(--accent); font-family: var(--display); font-weight: 800; font-size: .9rem; padding: 0 5px; }
  .squad-table tr.group th { text-align: left; text-transform: uppercase; letter-spacing: .1em; font-size: .72rem; color: var(--accent); padding-top: 16px; }

  /* Historia */
  .trophies { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .trophy-tile { display: grid; justify-items: center; gap: 2px; padding: 14px 6px; border-radius: 16px; text-align: center; background: linear-gradient(180deg, color-mix(in srgb, #fbbf24 18%, var(--surface-2)), var(--surface-2)); min-width: 0; }
  .trophy { font-size: 1.5rem; }
  .trophy-count { font-family: var(--display); font-weight: 800; font-size: 2.6rem; line-height: 1; color: var(--gold); }
  .trophy-tile strong { font-size: .85rem; }
  .hist-bars { margin-bottom: 4px; }
  .one-title { margin: 16px 0 8px; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: .8rem; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); }

  footer { padding-bottom: 32px; font-size: .8rem; color: var(--muted); }

  @media (max-width: 560px) {
    .full { display: none; }
    .abbr { display: inline; }
    .opt { display: none; }
    th, td { padding: 8px 3px; }
    .card { padding: 14px 12px; border-radius: 16px; }
    .form i { width: 8px; height: 8px; border-radius: 50%; font-size: 0; }
    .form { gap: 2px; }
    .squad-table td.country span { display: none; }
    .select-wrap { max-width: none; }
    .podium { gap: 6px; }
    .podium-card { padding: 12px 4px; }
    .podium-card strong { font-size: .78rem; }
    .bar-row { grid-template-columns: minmax(96px, 8.5em) 1fr 2.2em; }
  }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <div class="hero-top">
      <span class="brand"><span class="ball">⚽</span> Fútbol CR</span>
      <div class="hero-actions">
        <button class="theme-btn share-btn" type="button" id="share-btn" data-url="${PAGE_URL}" data-text="${esc(SHARE_TEXT)}">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
          Compartir
        </button>
        <button class="theme-btn" type="button" id="theme-btn" aria-label="Cambiar tema">Tema</button>
      </div>
    </div>
    <p class="eyebrow">Costa Rica · Liga FPD</p>
    <h1>Primera <br>División</h1>
    <div class="hero-chips">
      <span class="hchip accent">${esc(s?.tournament ?? 'Apertura')} ${year}</span>
      ${jornada ? `<span class="hchip">Jornada <b>${jornada}</b></span>` : ''}
      <span class="hchip">Actualizado <b><time datetime="${esc(stamp)}">${esc(fmtShort(stamp))}</time></b></span>
    </div>
    <nav class="tabbar" aria-label="Secciones">
      ${TABS.map(([id, name, path]) => `<a class="tab-link" data-tab="${id}" href="#${id}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg><span>${name}</span></a>`).join('')}
    </nav>
  </div>
</header>
<main class="wrap">
  <div class="panel" data-tab="inicio">
    ${kpis(data, teamsByName)}
    ${warnings}
    <section class="card live-card" hidden>${sectionHead('envivo', 'Se actualiza solo', 'Partidos de hoy')}<ul class="matches" id="live-list"></ul><p class="note" id="live-note"></p></section>
    <div class="grid home">
      <section class="card">${sectionHead('zona', 'Apertura ' + year, 'Zona de semifinales')}${miniStandings(s, form)}</section>
      <section class="card">${sectionHead('proximos', 'Calendario', 'Próximos partidos')}${calendarBox()}${matchList(data.upcoming, 'upcoming')}</section>
      <section class="card">${sectionHead('resultados', 'Últimas 2 jornadas', 'Resultados')}${matchList(data.results, 'results')}</section>
    </div>
  </div>
  <div class="panel" data-tab="tabla">
    <div class="grid two-wide">
      <section class="card">${sectionHead('posiciones', 'Apertura ' + year, 'Tabla de posiciones')}${standingsSection(s, form)}</section>
      <section class="card">${sectionHead('puntos', 'Comparativo', 'Puntos por equipo')}${pointsChart(s)}</section>
    </div>
  </div>
  <div class="panel" data-tab="goleadores">
    <div class="grid narrow"><section class="card">${sectionHead('top10', 'Top 10', 'Goleadores')}${scorersSection(data.scorers, teamsByName)}</section>
    <section class="card">${sectionHead('asistencias', 'Top 10', 'Asistencias')}${assistsSection(data.assists, teamsByName)}</section></div>
  </div>
  <div class="panel" data-tab="plantillas">
    <section class="card">${sectionHead('jugadores', 'Jugadores', 'Plantillas')}${squadsSection(data.squads)}</section>
  </div>
  <div class="panel" data-tab="historia">
    <div class="grid narrow"><section class="card">${sectionHead('palmares', 'Palmarés', esc(data.history?.title ?? 'Historia'))}${historySection(data.history)}</section></div>
  </div>
</main>
<footer class="wrap">
  <p><a class="wa-link" href="https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + '\n' + PAGE_URL)}" target="_blank" rel="noopener">Compartir por WhatsApp</a></p>
  Fuente: ${esc(data.source)}. Última actualización: ${esc(fmtStamp(stamp))} (hora de Costa Rica).
</footer>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
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

    var sel = document.getElementById('squad-select');
    if (sel) {
      var showSquad = function (id) {
        document.querySelectorAll('.squad').forEach(function (el) { el.hidden = el.dataset.team !== id; });
      };
      try { var saved = localStorage.getItem('squad'); if (saved && sel.querySelector('option[value="' + saved + '"]')) sel.value = saved; } catch (e) {}
      showSquad(sel.value);
      sel.addEventListener('change', function () {
        showSquad(sel.value);
        try { localStorage.setItem('squad', sel.value); } catch (e) {}
      });
    }

    // Compartir: usa el menú nativo del celular; si no existe (compu), copia el link.
    var toast = document.getElementById('toast'), toastTimer;
    function notify(msg) {
      toast.textContent = msg; toast.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2600);
    }
    var shareBtn = document.getElementById('share-btn');
    shareBtn.addEventListener('click', function () {
      var tab = root.dataset.tab;
      var url = shareBtn.dataset.url + (tab && tab !== 'inicio' ? '#' + tab : ''), text = shareBtn.dataset.text;
      if (navigator.share) {
        navigator.share({ title: document.title, text: text, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text + '\\n' + url).then(
          function () { notify('Link copiado: pégalo en WhatsApp'); },
          function () { prompt('Copia este link:', url); });
      } else {
        prompt('Copia este link:', url);
      }
    });

    // Para abrirla como app y sin conexión.
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    // Partidos de hoy en vivo: el navegador le pregunta directo a ESPN, cada minuto mientras se juega.
    (function () {
      var card = document.querySelector('.live-card');
      if (!card || !window.fetch || !window.Intl) return;
      var TEAMS = ${JSON.stringify(Object.fromEntries((s?.rows ?? []).map(r => [r.id, { n: label(r), a: r.abbr, l: r.logo }]))).replace(/</g, '\\u003c')};
      var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/crc.1/scoreboard?dates=';
      var TZ = 'America/Costa_Rica', DAY = 864e5, timer = null;
      var list = document.getElementById('live-list'), note = document.getElementById('live-note');
      function ymd(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, ''); }
      function hhmm(d) { return new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
      function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
      function side(c, cls, home) {
        var t = TEAMS[c.team.id] || { n: c.team.shortDisplayName || c.team.displayName, a: c.team.abbreviation, l: c.team.logo };
        var img = t.l ? '<img class="logo" src="' + esc(t.l) + '" alt="" width="28" height="28">' : '';
        var name = '<span class="name">' + esc(t.n) + '</span><span class="name-abbr">' + esc(t.a) + '</span>';
        return '<span class="side ' + (home ? 'home' : 'away') + cls + '">' + (home ? name + img : img + name) + '</span>';
      }
      function item(e) {
        var st = e.status.type, comp = e.competitions[0], live = st.state === 'in';
        var h = comp.competitors.filter(function (c) { return c.homeAway === 'home'; })[0];
        var a = comp.competitors.filter(function (c) { return c.homeAway === 'away'; })[0];
        var off = /POSTPONED|CANCELED|SUSPENDED|DELAYED/.test(st.name);
        var hs = Number(h.score), as = Number(a.score), done = st.state === 'post' && !off;
        function res(x, y) { return !done ? '' : x > y ? ' win' : x === y ? ' draw' : ' lose'; }
        var meta = off ? '<strong class="live">Aplazado</strong>'
          : live ? '<strong class="live"><i class="pulse"></i>En vivo · ' + (st.name === 'STATUS_HALFTIME' ? 'Medio tiempo' : esc(e.status.displayClock)) + '</strong>'
          : done ? '<strong>Final</strong>' : 'Hoy';
        var center = live || done
          ? '<span class="score' + (live ? ' live-score' : '') + '">' + esc(h.score) + '<span class="dash">–</span>' + esc(a.score) + '</span>'
          : '<span class="kick">' + hhmm(new Date(e.date)) + '</span>';
        var goals = (comp.details || []).filter(function (d) { return d.scoringPlay; }).map(function (d) {
          var who = (d.athletesInvolved || [])[0];
          return '<li class="' + (d.team && d.team.id === h.team.id ? 'g-home' : 'g-away') + '">⚽ ' + esc(d.clock && d.clock.displayValue) + ' ' + esc(who ? who.displayName : 'Gol') + (d.ownGoal ? ' (a.g.)' : d.penaltyKick ? ' (pen.)' : '') + '</li>';
        }).join('');
        var venue = comp.venue && comp.venue.fullName ? '<span class="venue">' + esc(comp.venue.fullName) + '</span>' : '';
        return '<li class="match' + (live ? ' is-live' : '') + '"><div class="match-meta"><span class="date-chip">' + meta + '</span>' + venue + '</div>'
          + '<div class="match-line">' + side(h, res(hs, as), true) + center + side(a, res(as, hs), false) + '</div>'
          + (goals ? '<ul class="goal-list">' + goals + '</ul>' : '') + '</li>';
      }
      function load() {
        clearTimeout(timer);
        var now = Date.now(), today = ymd(new Date(now));
        // ESPN agrupa los días con otra zona horaria: se piden ayer, hoy y mañana y se filtra por la fecha de Costa Rica.
        Promise.all([now - DAY, now, now + DAY].map(function (t) {
          return fetch(API + ymd(new Date(t)), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { events: [] }; });
        })).then(function (days) {
          var seen = {}, events = [];
          days.forEach(function (d) { (d.events || []).forEach(function (e) {
            if (seen[e.id]) return; seen[e.id] = 1;
            if (ymd(new Date(e.date)) === today || e.status.type.state === 'in') events.push(e);
          }); });
          if (!events.length) { card.hidden = true; return; }
          events.sort(function (x, y) { return new Date(x.date) - new Date(y.date); });
          list.innerHTML = events.map(item).join('');
          card.hidden = false;
          var live = events.some(function (e) { return e.status.type.state === 'in'; });
          var next = events.filter(function (e) { return e.status.type.name === 'STATUS_SCHEDULED'; })[0];
          note.textContent = 'Marcadores de ESPN, revisados a las ' + hhmm(new Date()) + (live ? ' (se refresca cada minuto)' : '') + '. La tabla y los goleadores se recalculan cada día a las 6:00 a.m.';
          // Mientras se juega, cada minuto; si falta un partido, se vuelve a mirar cerca de la hora de inicio.
          var wait = live ? 60e3 : next ? Math.min(10 * 60e3, Math.max(60e3, new Date(next.date) - Date.now())) : 0;
          if (wait) timer = setTimeout(load, wait);
        }).catch(function () { timer = setTimeout(load, 2 * 60e3); });
      }
      document.addEventListener('visibilitychange', function () { if (document.hidden) clearTimeout(timer); else load(); });
      load();
    })();

    // Cuenta regresiva del próximo partido (se calcula al abrir la página).
    document.querySelectorAll('.countdown').forEach(function (el) {
      var ms = new Date(el.dataset.date) - Date.now();
      if (ms < -2 * 3600e3) { el.textContent = 'ya se jugó'; return; }
      if (ms < 0) { el.textContent = 'en juego'; return; }
      var h = Math.floor(ms / 3600e3), d = Math.floor(h / 24);
      el.textContent = d >= 2 ? 'en ' + d + ' días' : d === 1 ? 'mañana' : h >= 1 ? 'en ' + h + ' h' : 'en ' + Math.max(1, Math.round(ms / 60e3)) + ' min';
    });

    // Pestañas: la pestaña activa va en el #hash del link (se puede compartir, p. ej. #plantillas).
    function showTab(hash, push) {
      var id = (hash || '').replace('#', '');
      var tab = TAB_OF[id] || 'inicio';
      root.dataset.tab = tab;
      if (push) history.pushState(null, '', '#' + tab);
      var target = id && id !== tab ? document.getElementById(id) : null;
      if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
    }
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        showTab(a.getAttribute('href'), true);
      });
    });
    window.addEventListener('popstate', function () { showTab(location.hash, false); });
    if (location.hash && location.hash !== '#' + root.dataset.tab) showTab(location.hash, false);
  })();
</script>
</body>
</html>
`;
}

// Revisa que el JavaScript de la página no tenga errores de sintaxis antes de escribirla.
function checkScripts(html) {
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { new Function(code); } catch (err) { throw new Error(`El script de la página tiene un error: ${err.message}`); }
  }
}

export async function render(data) {
  const html = buildHtml(data);
  checkScripts(html);
  await mkdir(new URL('public/', ROOT), { recursive: true });
  await writeFile(new URL('public/index.html', ROOT), html, 'utf8');
  await writeFile(new URL('public/partidos.ics', ROOT), buildIcs(data, { pageUrl: PAGE_URL }), 'utf8');
}

// Uso directo: `npm run render` regenera el HTML desde data/data.json sin descargar nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(await readFile(new URL('data/data.json', ROOT), 'utf8'));
  await render(data);
  console.log('→ public/index.html');
}
