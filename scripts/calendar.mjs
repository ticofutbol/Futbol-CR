// Genera el calendario public/partidos.ics (formato iCalendar, RFC 5545) a partir de data/data.json.
// Incluye los partidos jugados de la temporada (con marcador) y los próximos (con aviso 30 min antes).

const MATCH_HOURS = 2;
const ALARM_MINUTES = 30;

// Fecha en UTC con el formato de iCalendar: 20261031T000000Z
const icsDate = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Escapa los caracteres especiales de los valores de texto.
const text = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Las líneas de más de 75 bytes se parten y continúan con un espacio (sin cortar caracteres UTF-8).
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function event(m, { stamp, tournament, pageUrl }) {
  const start = new Date(m.date);
  const end = new Date(start.getTime() + MATCH_HOURS * 3600e3);
  const done = m.completed;
  const summary = done
    ? `${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}`
    : `⚽ ${m.home.name} vs ${m.away.name}`;
  const lines = [
    'BEGIN:VEVENT',
    `UID:espn-${m.id}@futbol-cr`,
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${text(summary)}`,
    m.venue ? `LOCATION:${text(m.venue)}` : null,
    `DESCRIPTION:${text(`Primera División de Costa Rica · ${tournament}${done ? ' · Final' : ''}${pageUrl ? `\n${pageUrl}` : ''}`)}`,
    'CATEGORIES:Fútbol',
    `STATUS:${done ? 'CONFIRMED' : 'TENTATIVE'}`,
    'TRANSP:TRANSPARENT',
  ];
  if (!done) lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(`${m.home.name} vs ${m.away.name} empieza en ${ALARM_MINUTES} minutos`)}`,
    `TRIGGER:-PT${ALARM_MINUTES}M`,
    'END:VALARM',
  );
  lines.push('END:VEVENT');
  return lines.filter(Boolean);
}

export function buildIcs(data, { pageUrl = '' } = {}) {
  const stamp = data.generatedAt ?? new Date().toISOString();
  const tournament = `${data.standings?.tournament ?? 'Apertura'} ${new Date(stamp).getFullYear()}`;
  const byId = new Map();
  for (const m of data.results?.all ?? data.results?.matches ?? []) byId.set(m.id, m);
  for (const m of data.upcoming?.all ?? data.upcoming?.matches ?? []) byId.set(m.id, m);
  const matches = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//futbol-cr//Primera Division CR//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Primera División CR',
    `X-WR-CALDESC:${text(`Partidos de la Primera División de Costa Rica (${tournament}). Se actualiza todos los días.`)}`,
    'X-WR-TIMEZONE:America/Costa_Rica',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...matches.flatMap(m => event(m, { stamp, tournament, pageUrl })),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
