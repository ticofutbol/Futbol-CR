// Revisión rápida para el workflow: ¿terminó algún partido que todavía no está en data/data.json?
// Escribe "cambios=true" o "cambios=false" en $GITHUB_OUTPUT (y en la consola).
// Si ESPN no responde, responde false: la próxima revisión (o la de las 6:00 a.m.) lo vuelve a intentar.
import { readFile, appendFile } from 'node:fs/promises';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/crc.1';
const ymd = t => new Date(t - 6 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); // fecha en Costa Rica

async function check() {
  const data = JSON.parse(await readFile(new URL('../data/data.json', import.meta.url), 'utf8'));
  const known = new Set((data.results?.all ?? []).map(m => m.id));
  // Hoy y ayer: un partido de la noche puede terminar después de medianoche.
  const days = [ymd(Date.now() - 864e5), ymd(Date.now())];
  for (const day of days) {
    const res = await fetch(`${SITE}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const ev of (await res.json()).events ?? []) {
      if (ev.status?.type?.completed && !known.has(ev.id)) {
        console.log(`Terminó: ${ev.name} (${ev.id})`);
        return true;
      }
    }
  }
  return false;
}

let cambios;
try {
  cambios = await check();
} catch (err) {
  console.log(`No se pudo revisar (${err.message}); se intenta en la próxima revisión.`);
  cambios = false;
}
console.log(`cambios=${cambios}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `cambios=${cambios}\n`);
