// Revisión para el workflow: ¿terminó algún partido que todavía no está en data/data.json?
// GitHub no respeta el "cada 15 minutos" (en la práctica corre cada 40-70 min). Por eso, si hay un partido
// en juego o por empezar, esta revisión se queda esperando y mira ESPN cada 2 minutos hasta que termine.
// Escribe "cambios=true" o "cambios=false" en $GITHUB_OUTPUT (y en la consola).
import { readFile, appendFile } from 'node:fs/promises';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/crc.1';
const EVERY = 2 * 60e3;        // cada cuánto se vuelve a mirar mientras se espera
const MAX_WAIT = 170 * 60e3;   // como mucho (el job tiene un límite un poco mayor)
const SOON = 75 * 60e3;        // también se espera si un partido empieza dentro de este tiempo
const ymd = t => new Date(t - 6 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); // fecha en Costa Rica
const sleep = ms => new Promise(r => setTimeout(r, ms));

const data = JSON.parse(await readFile(new URL('../data/data.json', import.meta.url), 'utf8'));
const known = new Set((data.results?.all ?? []).map(m => m.id));

// Hoy y ayer: un partido de la noche puede terminar después de medianoche.
async function scan() {
  let pending = false;
  for (const day of [ymd(Date.now() - 864e5), ymd(Date.now())]) {
    const res = await fetch(`${SITE}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const ev of (await res.json()).events ?? []) {
      const st = ev.status?.type ?? {};
      if (st.completed && !known.has(ev.id)) return { finished: ev };
      if (/POSTPONED|CANCELED|SUSPENDED/.test(st.name ?? '')) continue;
      if (st.state === 'in' || (st.state === 'pre' && new Date(ev.date) - Date.now() < SOON)) pending = true;
    }
  }
  return { pending };
}

async function check() {
  const start = Date.now();
  for (;;) {
    try {
      const { finished, pending } = await scan();
      if (finished) { console.log(`Terminó: ${finished.name} (${finished.id})`); return true; }
      if (!pending) return false;
      console.log(`${new Date().toISOString()}: hay un partido en juego o por empezar; se vuelve a mirar en 2 min.`);
    } catch (err) {
      console.log(`No se pudo revisar (${err.message}); se reintenta en 2 min.`);
    }
    if (Date.now() - start > MAX_WAIT) return false;
    await sleep(EVERY);
  }
}

const cambios = await check();
console.log(`cambios=${cambios}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `cambios=${cambios}\n`);
