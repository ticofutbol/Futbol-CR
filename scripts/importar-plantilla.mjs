// Importa la plantilla de un equipo copiada de Transfermarkt (texto pegado) a data/dorsales.json.
// Guarda solo dorsal, nombre, posición, edad y nacionalidades; descarta contrato y valor de mercado.
//
// Uso:  node scripts/importar-plantilla.mjs <archivo.txt> "<Equipo como lo nombra ESPN>"
// Ej.:  node scripts/importar-plantilla.mjs puntarenas.txt "Puntarenas FC"
import { readFile, writeFile } from 'node:fs/promises';

const [file, team] = process.argv.slice(2);
if (!file || !team) {
  console.error('Uso: node scripts/importar-plantilla.mjs <archivo.txt> "<Equipo>"');
  process.exit(1);
}

// Posiciones de Transfermarkt → grupos de la página (G, D, M, F).
const POSITION = [
  [/portero/i, 'G'],
  [/defensa|lateral|líbero|libero/i, 'D'],
  [/pivote|mediocentro|mediapunta|interior|volante|medio/i, 'M'],
  [/extremo|delantero|punta|segundo/i, 'F'],
];
const positionOf = text => POSITION.find(([re]) => re.test(text))?.[1] ?? null;

// Cada jugador ocupa estas líneas:
//   dorsal (o "-" si no tiene) [TAB club anterior]
//   Nombre TAB Nombre
//   Posición
//   edad TAB país1 [TAB contrato TAB valor]
//   [país2 TAB contrato TAB valor]        ← solo si tiene doble nacionalidad
export function parse(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trimEnd());
  const players = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2}|-)(\t|$)/);
    const nameLine = lines[i + 1] ?? '';
    if (!m || !nameLine.includes('\t')) continue;
    const name = nameLine.split('\t')[0].trim();
    const position = (lines[i + 2] ?? '').trim();
    const ageCols = (lines[i + 3] ?? '').split('\t').map(s => s.trim());
    const age = /^\d+$/.test(ageCols[0]) ? Number(ageCols[0]) : null;
    const countries = [ageCols[1]].filter(Boolean);
    // Si la línea de edad trae solo "edad, país", la siguiente empieza con la segunda nacionalidad.
    if (ageCols.length === 2) {
      const second = (lines[i + 4] ?? '').split('\t')[0].trim();
      if (second && second !== '-' && !/^\d/.test(second)) countries.push(second);
    }
    players.push({ jersey: m[1] === '-' ? null : Number(m[1]), name, position: positionOf(position), positionText: position, age, countries });
    i += 3;
  }
  return players;
}

if (process.argv[1]?.endsWith('importar-plantilla.mjs')) {
  const players = parse(await readFile(file, 'utf8'));
  if (!players.length) { console.error('No encontré jugadores en el texto.'); process.exit(1); }
  const target = new URL('../data/dorsales.json', import.meta.url);
  let db;
  try { db = JSON.parse(await readFile(target, 'utf8')); } catch { db = { _info: '', teams: {} }; }
  db._info = 'Dorsales, posiciones y nacionalidades copiados a mano de Transfermarkt. Completan lo que ESPN no trae. Para emparejar un nombre distinto al de ESPN, agrega "espn": "<nombre en ESPN>" al jugador.';
  const prev = db.teams[team]?.players ?? [];
  // Conserva los emparejamientos manuales ("espn") de una importación anterior.
  for (const p of players) { const old = prev.find(o => o.name === p.name); if (old?.espn) p.espn = old.espn; }
  db.teams[team] = { updated: new Date().toISOString().slice(0, 10), source: 'Transfermarkt (copiado a mano)', players };
  await writeFile(target, JSON.stringify(db, null, 2) + '\n', 'utf8');
  console.log(`${team}: ${players.length} jugadores guardados en data/dorsales.json`);
  for (const p of players) console.log(`  #${String(p.jersey ?? '-').padStart(2)} ${p.name.padEnd(24)} ${(p.position ?? '?')} ${p.age ?? '-'} ${p.countries.join(' / ')}`);
}
