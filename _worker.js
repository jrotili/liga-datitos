// =============================================================================
// LIGA PROFESIONAL · Datitos Worker
// Sirve el HTML del frontend desde /public y expone /api/data con todos
// los datos derivados de API-Football, cacheados en KV + edge cache.
//
// Endpoints:
//   GET /             → HTML (vía [assets])
//   GET /api/data     → JSON agregado para el frontend
//   GET /api/health   → health check
// =============================================================================

// =============================================================================
// CONFIG
// =============================================================================
const API_BASE = 'https://v3.football.api-sports.io';

const TTL = {
  fixtures:    600,         // 10 min (vivo)
  scorers:     3600,        // 1 hora
  copas:       1800,        // 30 min
  teams:       7 * 86400,   // 7 días
  aggregated:  300,         // 5 min en edge cache
};

// =============================================================================
// CONFIG ESTÁTICA · 30 equipos, zonas, regiones, clásicos, históricos
// =============================================================================
// Para matching desde API-Football: aliases normalizados (lowercase, sin tildes)
const TEAMS = [
  // Zona A
  {id:1,  name:'Boca Juniors',           short:'BOC', zone:'A', region:'amba',     aliases:['boca juniors','ca boca juniors','boca jrs','boca']},
  {id:2,  name:'Independiente',          short:'IND', zone:'A', region:'amba',     aliases:['independiente','ca independiente','club atletico independiente']},
  {id:3,  name:'San Lorenzo',            short:'SLO', zone:'A', region:'amba',     aliases:['san lorenzo','san lorenzo de almagro','ca san lorenzo']},
  {id:4,  name:'Vélez Sarsfield',        short:'VEL', zone:'A', region:'amba',     aliases:['velez sarsfield','velez','ca velez sarsfield']},
  {id:5,  name:'Estudiantes (LP)',       short:'ELP', zone:'A', region:'amba',     aliases:['estudiantes','estudiantes lp','estudiantes la plata','estudiantes de la plata']},
  {id:6,  name:'Lanús',                  short:'LAN', zone:'A', region:'amba',     aliases:['lanus','ca lanus','club atletico lanus']},
  {id:7,  name:'Platense',               short:'PLA', zone:'A', region:'amba',     aliases:['platense','ca platense','club atletico platense']},
  {id:8,  name:'Defensa y Justicia',     short:'DYJ', zone:'A', region:'amba',     aliases:['defensa y justicia','defensa justicia']},
  {id:9,  name:'Deportivo Riestra',      short:'RIE', zone:'A', region:'amba',     aliases:['deportivo riestra','riestra']},
  {id:10, name:'Talleres',               short:'TAL', zone:'A', region:'interior', aliases:['talleres','talleres cordoba','talleres de cordoba','ca talleres']},
  {id:11, name:"Newell's Old Boys",      short:'NOB', zone:'A', region:'interior', aliases:['newells old boys','newells','newell\'s old boys','ca newells old boys']},
  {id:12, name:'Instituto',              short:'INS', zone:'A', region:'interior', aliases:['instituto','instituto cordoba','instituto ac cordoba']},
  {id:13, name:'Unión',                  short:'UNI', zone:'A', region:'interior', aliases:['union','union santa fe','union de santa fe']},
  {id:14, name:'Central Córdoba (SdE)',  short:'CCO', zone:'A', region:'interior', aliases:['central cordoba','central cordoba sde','central cordoba santiago']},
  {id:15, name:'Gimnasia (Mza.)',        short:'GIM', zone:'A', region:'interior', aliases:['gimnasia mendoza','gimnasia y esgrima mendoza','gimnasia y esgrima de mendoza']},
  // Zona B
  {id:16, name:'River Plate',            short:'RIV', zone:'B', region:'amba',     aliases:['river plate','river','ca river plate']},
  {id:17, name:'Racing Club',            short:'RAC', zone:'B', region:'amba',     aliases:['racing club','racing','racing club avellaneda']},
  {id:18, name:'Huracán',                short:'HUR', zone:'B', region:'amba',     aliases:['huracan','ca huracan','club atletico huracan']},
  {id:19, name:'Argentinos Juniors',     short:'ARG', zone:'B', region:'amba',     aliases:['argentinos juniors','argentinos jrs','argentinos','aa argentinos juniors']},
  {id:20, name:'Tigre',                  short:'TIG', zone:'B', region:'amba',     aliases:['tigre','ca tigre','club atletico tigre']},
  {id:21, name:'Banfield',               short:'BAN', zone:'B', region:'amba',     aliases:['banfield','ca banfield']},
  {id:22, name:'Gimnasia (LP)',          short:'GLP', zone:'B', region:'amba',     aliases:['gimnasia la plata','gimnasia y esgrima la plata','gimnasia y esgrima de la plata','gimnasia lp']},
  {id:23, name:'Barracas Central',       short:'BAR', zone:'B', region:'amba',     aliases:['barracas central','barracas']},
  {id:24, name:'Rosario Central',        short:'RCE', zone:'B', region:'interior', aliases:['rosario central','ca rosario central']},
  {id:25, name:'Belgrano',               short:'BEL', zone:'B', region:'interior', aliases:['belgrano','ca belgrano','belgrano cordoba']},
  {id:26, name:'Atlético Tucumán',       short:'ATU', zone:'B', region:'interior', aliases:['atletico tucuman','atl tucuman','ca tucuman']},
  {id:27, name:'Sarmiento',              short:'SAR', zone:'B', region:'interior', aliases:['sarmiento','sarmiento junin','ca sarmiento']},
  {id:28, name:'Indep. Rivadavia (Mza.)',short:'IRM', zone:'B', region:'interior', aliases:['independiente rivadavia','independiente rivadavia mendoza','cs independiente rivadavia']},
  {id:29, name:'Estudiantes (Río IV)',   short:'ERC', zone:'B', region:'interior', aliases:['estudiantes rio cuarto','estudiantes rc','estudiantes de rio cuarto']},
  {id:30, name:'Aldosivi',               short:'ALD', zone:'B', region:'interior', aliases:['aldosivi','ca aldosivi','club atletico aldosivi']},
];
const TEAM_BY_ID = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// 15 clásicos interzonales preasignados 2026 (pares por id)
const CLASICOS = [
  [11,24],[1,16],[2,17],[3,18],[5,22],[8,30],[13,27],[9,23],
  [15,28],[12,29],[10,25],[6,21],[4,20],[7,19],[14,26]
];

// Promedios históricos por id: puntos totales en cada temporada.
// ⚠️ TODO: verificar estos valores con datos oficiales.
// Se actualizan UNA VEZ por año al cerrar la temporada anterior.
const PROMEDIOS_HIST = {
  1:{p24:58,p25:64}, 2:{p24:44,p25:34}, 3:{p24:42,p25:31}, 4:{p24:50,p25:49},
  5:{p24:69,p25:58}, 6:{p24:47,p25:42}, 7:{p24:30,p25:25}, 8:{p24:55,p25:41},
  9:{p24:32,p25:46}, 10:{p24:54,p25:46}, 11:{p24:48,p25:51}, 12:{p24:31,p25:33},
  13:{p24:27,p25:28}, 14:{p24:34,p25:30}, 15:{p24:0, p25:0},   // ascendido 2026
  16:{p24:71,p25:68}, 17:{p24:62,p25:55}, 18:{p24:36,p25:44}, 19:{p24:45,p25:48},
  20:{p24:41,p25:32}, 21:{p24:38,p25:50}, 22:{p24:40,p25:38}, 23:{p24:28,p25:36},
  24:{p24:53,p25:60}, 25:{p24:42,p25:55}, 26:{p24:33,p25:39}, 27:{p24:30,p25:35},
  28:{p24:25,p25:34}, 29:{p24:0, p25:0},   // ascendido 2026
  30:{p24:18,p25:21},
};

// Para cada equipo, cuántos PJ tuvo en 2024 y 2025 (típicamente 30 en cada año
// de Primera, 0 si estaba en Nacional B)
const PJ_HIST = {
  // Casi todos: 30 + 30 = 60. Ajustar a ascendidos:
  15: {pj24:0, pj25:0},   // Gimnasia Mza
  29: {pj24:0, pj25:0},   // Estudiantes RC
  30: {pj24:25,pj25:28},  // Aldosivi (descendió y volvió - ejemplo, verificar)
};

// =============================================================================
// FETCH HANDLER · router
// =============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, ts: Date.now() });
    }
    if (url.pathname === '/api/data') {
      return handleAggregated(request, env, ctx);
    }
    // Todo lo demás: assets estáticos
    return env.ASSETS.fetch(request);
  }
};

// =============================================================================
// MAIN: /api/data
// =============================================================================
async function handleAggregated(request, env, ctx) {
  const edgeCache = caches.default;
  const cacheKey = new Request('https://cache.local/api/data');

  // 1) Edge cache primero
  const cached = await edgeCache.match(cacheKey);
  if (cached) return cached;

  try {
    // 2) Traer las 4 piezas de la API en paralelo (con caché KV adentro)
    const [fixtures, scorers, libFixtures, sudFixtures] = await Promise.all([
      fetchFixtures(env, ctx, Number(env.LEAGUE_ID), Number(env.SEASON)),
      fetchScorers (env, ctx, Number(env.LEAGUE_ID), Number(env.SEASON)),
      fetchFixturesCopa(env, ctx, Number(env.COPA_LIB_ID), Number(env.SEASON)).catch(()=>[]),
      fetchFixturesCopa(env, ctx, Number(env.COPA_SUD_ID), Number(env.SEASON)).catch(()=>[]),
    ]);

    // 3) Bootstrapear el mapping API team id → local id 1-30
    const teamMap = buildTeamMap(fixtures);

    // 4) Derivar todo lo que el frontend necesita
    const data = {
      meta:         buildMeta(fixtures),
      standings:    deriveStandings(fixtures, teamMap),
      promedios:    derivePromedios(fixtures, teamMap),
      fixture:      deriveNextFecha(fixtures, teamMap),
      clasicos:     deriveClasicos(fixtures, teamMap),
      scorers:      transformScorers(scorers, teamMap),
      arbitros:     deriveArbitros(fixtures, teamMap),
      arbRecords:   deriveArbRecords(fixtures, teamMap),
      rachas:       deriveRachas(fixtures, teamMap),
      continental:  deriveContinental(libFixtures, sudFixtures, teamMap),
      teamFixtures: deriveTeamFixtures(fixtures, teamMap),
    };

    const response = json(data, {
      'Cache-Control': `public, max-age=${TTL.aggregated}`,
    });

    // 5) Guardar en edge cache
    ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
    return response;

  } catch (err) {
    return json({ error: err.message || 'unknown' }, {}, 503);
  }
}

// =============================================================================
// API-FOOTBALL CLIENT con KV caching y stale-on-error
// =============================================================================
async function callApi(env, endpoint, params = {}) {
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);

  const data = await res.json();
  // API-Football pone errores en .errors (objeto, no array)
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)){
    throw new Error('API-Football: ' + JSON.stringify(data.errors));
  }
  return data.response;
}

// getCached: trata de servir desde KV; si está vencido o ausente, refresca.
// Si la llamada falla pero hay valor stale, lo devuelve antes que romper.
//
// KV es OPCIONAL: si no hay binding CACHE configurado, va derecho a la API.
// El edge cache de /api/data (5 min) sigue funcionando igual.
async function getCached(env, ctx, key, ttl, fetcher) {
  // Sin KV → fetch directo, sin caché persistente
  if (!env.CACHE) return fetcher();

  let stored = null;
  try {
    stored = await env.CACHE.get(key, { type: 'json' });
  } catch (e) {
    console.warn(`KV read failed for ${key}: ${e.message}`);
  }
  if (stored && stored.expiresAt > Date.now()) return stored.value;

  try {
    const value = await fetcher();
    // Grace period: guardamos por TTL + 24hs para usar stale si la API falla después
    try {
      ctx.waitUntil(env.CACHE.put(key, JSON.stringify({
        value,
        expiresAt: Date.now() + ttl * 1000,
        cachedAt: Date.now(),
      }), { expirationTtl: ttl + 86400 }));
    } catch (e) {
      console.warn(`KV write failed for ${key}: ${e.message}`);
    }
    return value;
  } catch (err) {
    if (stored) {
      console.warn(`Stale fallback for ${key}: ${err.message}`);
      return stored.value;
    }
    throw err;
  }
}

function fetchFixtures(env, ctx, leagueId, season){
  return getCached(env, ctx, `fix:${leagueId}:${season}:v1`, TTL.fixtures,
    () => callApi(env, '/fixtures', { league: leagueId, season }));
}
function fetchScorers(env, ctx, leagueId, season){
  return getCached(env, ctx, `scorers:${leagueId}:${season}:v1`, TTL.scorers,
    () => callApi(env, '/players/topscorers', { league: leagueId, season }));
}
function fetchFixturesCopa(env, ctx, leagueId, season){
  return getCached(env, ctx, `copa:${leagueId}:${season}:v1`, TTL.copas,
    () => callApi(env, '/fixtures', { league: leagueId, season }));
}

// =============================================================================
// TEAM MAPPING (API team_id → local id 1-30)
// =============================================================================
function normalizeName(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // sin tildes
    .replace(/[.,()'"]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

// Recibe los fixtures crudos de API-Football y devuelve Map<apiTeamId, localId>
function buildTeamMap(fixtures){
  // Recolectar todos los (apiId, name) únicos vistos en fixtures
  const seen = new Map();
  for (const fx of fixtures || []){
    if (fx.teams?.home) seen.set(fx.teams.home.id, fx.teams.home.name);
    if (fx.teams?.away) seen.set(fx.teams.away.id, fx.teams.away.name);
  }

  // Indexar aliases para matching rápido
  const aliasIdx = new Map();
  for (const t of TEAMS) for (const a of t.aliases) aliasIdx.set(normalizeName(a), t.id);

  const map = new Map();
  const unmatched = [];
  for (const [apiId, apiName] of seen){
    const norm = normalizeName(apiName);
    let localId = aliasIdx.get(norm);
    if (!localId){
      // Match parcial: probar si el nombre normalizado contiene algún alias
      for (const [alias, id] of aliasIdx){
        if (alias.length >= 5 && (norm.includes(alias) || alias.includes(norm))){
          localId = id; break;
        }
      }
    }
    if (localId) map.set(apiId, localId);
    else unmatched.push({apiId, apiName});
  }
  if (unmatched.length) console.warn('Equipos sin matchear:', unmatched);
  return map;
}

// =============================================================================
// DERIVERS
// =============================================================================

// --- META: cuenta partidos jugados, próxima fecha, goles totales
function buildMeta(fixtures){
  let played = 0, goals = 0, totalGroup = 0, nextRound = null;
  for (const fx of fixtures){
    if (!isGroupStage(fx)) continue;
    totalGroup++;
    if (fx.fixture.status.short === 'FT'){
      played++;
      goals += (fx.goals.home||0) + (fx.goals.away||0);
    }
  }
  const next = pickNextRound(fixtures);
  return {
    updatedAt: new Date().toISOString(),
    season: fixtures[0]?.league?.season,
    fecha: next?.numero ?? null,
    partidos: played,
    partidosTotales: totalGroup,
    goles: goals,
  };
}

function isGroupStage(fx){
  const round = String(fx.league?.round || '').toLowerCase();
  // Excluir octavos/cuartos/semis/final
  return !round.includes('round of') && !round.includes('quarter')
      && !round.includes('semi')     && !round.includes('final');
}
function getRoundNumber(fx){
  // API-Football suele devolver "Regular Season - 11" o similar
  const m = String(fx.league?.round || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// --- STANDINGS por zona (derivado de fixtures FT)
function deriveStandings(fixtures, teamMap){
  const table = {};
  for (const t of TEAMS) table[t.id] = {tid:t.id, pj:0,g:0,e:0,p:0,gf:0,gc:0,pts:0};

  for (const fx of fixtures){
    if (fx.fixture.status.short !== 'FT' || !isGroupStage(fx)) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId || !aId) continue;
    const hG = fx.goals.home, aG = fx.goals.away;
    const h = table[hId], a = table[aId];
    h.pj++; a.pj++;
    h.gf += hG; h.gc += aG;
    a.gf += aG; a.gc += hG;
    if (hG > aG){ h.g++; h.pts+=3; a.p++; }
    else if (hG < aG){ a.g++; a.pts+=3; h.p++; }
    else { h.e++; a.e++; h.pts++; a.pts++; }
  }

  const byZone = {A:[], B:[]};
  for (const t of TEAMS) byZone[t.zone].push(table[t.id]);
  for (const arr of Object.values(byZone)){
    arr.sort((x,y) => y.pts - x.pts || (y.gf-y.gc) - (x.gf-x.gc) || y.gf - x.gf);
  }
  return byZone;
}

// --- PROMEDIOS · p24 + p25 (históricos) + p26 (derivado de fixtures actuales)
function derivePromedios(fixtures, teamMap){
  // Calcular p26 y pj26 desde fixtures
  const cur = {};
  for (const t of TEAMS) cur[t.id] = {p26:0, pj26:0};

  for (const fx of fixtures){
    if (fx.fixture.status.short !== 'FT' || !isGroupStage(fx)) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId || !aId) continue;
    const hG = fx.goals.home, aG = fx.goals.away;
    cur[hId].pj26++; cur[aId].pj26++;
    if (hG > aG){ cur[hId].p26 += 3; }
    else if (hG < aG){ cur[aId].p26 += 3; }
    else { cur[hId].p26++; cur[aId].p26++; }
  }

  return TEAMS.map(t => {
    const hist = PROMEDIOS_HIST[t.id] || {p24:0, p25:0};
    const pjHist = PJ_HIST[t.id] || {pj24:30, pj25:30};
    return {
      tid: t.id,
      p24: hist.p24,
      p25: hist.p25,
      p26: cur[t.id].p26,
      pj:  (pjHist.pj24 || 0) + (pjHist.pj25 || 0) + cur[t.id].pj26,
    };
  });
}

// --- PRÓXIMA FECHA · armar el detalle día/hora/sede/árbitro
function pickNextRound(fixtures){
  // Buscar la menor round number entre fixtures NO terminados
  let nextNum = null;
  for (const fx of fixtures){
    if (!isGroupStage(fx)) continue;
    if (fx.fixture.status.short === 'FT') continue;
    const n = getRoundNumber(fx);
    if (n !== null && (nextNum === null || n < nextNum)) nextNum = n;
  }
  if (nextNum === null) return null;
  return { numero: nextNum };
}

function deriveNextFecha(fixtures, teamMap){
  const next = pickNextRound(fixtures);
  if (!next) return { numero: null, partidos: [], libres: [] };

  const partidos = [];
  const playingTeams = new Set();
  for (const fx of fixtures){
    if (!isGroupStage(fx)) continue;
    if (getRoundNumber(fx) !== next.numero) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId || !aId) continue;
    playingTeams.add(hId); playingTeams.add(aId);
    const d = new Date(fx.fixture.date);
    partidos.push({
      home: hId, away: aId,
      day:  formatDay(d),
      time: formatTime(d),
      venue: fx.fixture.venue?.name || '—',
      ref:   fx.fixture.referee || '—',
    });
  }
  partidos.sort((x,y) => x.day.localeCompare(y.day) || x.time.localeCompare(y.time));

  const libres = TEAMS.filter(t => !playingTeams.has(t.id)).map(t => t.id);
  return { numero: next.numero, partidos, libres };
}

function formatDay(d){
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dias[d.getDay()]} ${dd}/${mm}`;
}
function formatTime(d){
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// --- CLÁSICOS: matchear los 15 pares contra los fixtures del año
function deriveClasicos(fixtures, teamMap){
  return CLASICOS.map(([a, b]) => {
    // Buscar el único fixture FT/scheduled donde se enfrenten estos dos
    for (const fx of fixtures){
      if (!isGroupStage(fx)) continue;
      const hId = teamMap.get(fx.teams.home.id);
      const aId = teamMap.get(fx.teams.away.id);
      if ((hId === a && aId === b) || (hId === b && aId === a)){
        const played = fx.fixture.status.short === 'FT';
        if (played){
          // Devolver score con el orden del par original (a-b)
          return hId === a
            ? { played:true, home: fx.goals.home, away: fx.goals.away, fecha: getRoundNumber(fx) }
            : { played:true, home: fx.goals.away, away: fx.goals.home, fecha: getRoundNumber(fx) };
        }
        return { played:false, fecha: getRoundNumber(fx) };
      }
    }
    return { played:false, fecha: null };
  });
}

// --- SCORERS: transformar formato API → frontend
function transformScorers(scorers, teamMap){
  if (!Array.isArray(scorers)) return [];
  return scorers.slice(0, 10).map(s => ({
    name:  s.player?.name || '?',
    tid:   teamMap.get(s.statistics?.[0]?.team?.id) || null,
    goals: s.statistics?.[0]?.goals?.total ?? 0,
  })).filter(s => s.tid !== null);
}

// --- ÁRBITROS: agregar stats por nombre de árbitro
// ⚠️ Las tarjetas (am/rj) requieren /fixtures/events por partido y NO se incluyen en v1.
// Para v2: agregar un fetch adicional por cada fixture FT, cachear "for ever" por fixture id.
function deriveArbitros(fixtures, teamMap){
  const refs = {};
  for (const fx of fixtures){
    if (fx.fixture.status.short !== 'FT' || !isGroupStage(fx)) continue;
    const ref = fx.fixture.referee;
    if (!ref) continue;
    if (!refs[ref]) refs[ref] = {name:ref, pj:0, am:0, rj:0, gf:0, loc:0, vis:0, emp:0};
    const r = refs[ref];
    const hG = fx.goals.home, aG = fx.goals.away;
    r.pj++; r.gf += hG + aG;
    if (hG > aG) r.loc++;
    else if (hG < aG) r.vis++;
    else r.emp++;
  }
  // Ordenar por PJ descendente, top 12
  return Object.values(refs).sort((x,y) => y.pj - x.pj).slice(0, 12);
}

// --- ÁRBITRO RECORDS por equipo
function deriveArbRecords(fixtures, teamMap){
  const recs = {}; // refName → tid → {pj,g,e,p,gf,gc}
  for (const fx of fixtures){
    if (fx.fixture.status.short !== 'FT' || !isGroupStage(fx)) continue;
    const ref = fx.fixture.referee;
    if (!ref) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId || !aId) continue;
    if (!recs[ref]) recs[ref] = {};
    addTeamRec(recs[ref], hId, fx.goals.home, fx.goals.away);
    addTeamRec(recs[ref], aId, fx.goals.away, fx.goals.home);
  }
  // Transformar a [[tid, pj, g, e, p, gf, gc], ...] compacto
  const out = {};
  for (const [refName, byTid] of Object.entries(recs)){
    out[refName] = Object.entries(byTid).map(([tid, r]) =>
      [Number(tid), r.pj, r.g, r.e, r.p, r.gf, r.gc]);
  }
  return out;
}
function addTeamRec(byTid, tid, gf, gc){
  if (!byTid[tid]) byTid[tid] = {pj:0,g:0,e:0,p:0,gf:0,gc:0};
  const r = byTid[tid];
  r.pj++; r.gf += gf; r.gc += gc;
  if (gf > gc) r.g++;
  else if (gf < gc) r.p++;
  else r.e++;
}

// --- RACHAS: para cada equipo, contar últimos N partidos consecutivos
//     que cumplen cada condición. Devuelve top 5 de cada categoría.
function deriveRachas(fixtures, teamMap){
  // Agrupar fixtures FT por equipo, ordenados por fecha
  const byTeam = {};
  for (const t of TEAMS) byTeam[t.id] = [];
  for (const fx of fixtures){
    if (fx.fixture.status.short !== 'FT' || !isGroupStage(fx)) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId || !aId) continue;
    const date = new Date(fx.fixture.date).getTime();
    byTeam[hId].push({date, gf: fx.goals.home, gc: fx.goals.away});
    byTeam[aId].push({date, gf: fx.goals.away, gc: fx.goals.home});
  }
  for (const arr of Object.values(byTeam)) arr.sort((x,y) => y.date - x.date); // más reciente primero

  const invictos = [], singanar = [], sinrecibir = [], sinconvertir = [];
  for (const t of TEAMS){
    const games = byTeam[t.id];
    let n_inv=0, n_sg=0, n_sr=0, n_sc=0;
    let r_inv=true, r_sg=true, r_sr=true, r_sc=true;
    for (const g of games){
      if (r_inv && g.gf >= g.gc) n_inv++; else r_inv=false;
      if (r_sg  && g.gf <= g.gc) n_sg++;  else r_sg=false;
      if (r_sr  && g.gc === 0)   n_sr++;  else r_sr=false;
      if (r_sc  && g.gf === 0)   n_sc++;  else r_sc=false;
    }
    if (n_inv) invictos.push({tid:t.id, n:n_inv});
    if (n_sg)  singanar.push({tid:t.id, n:n_sg});
    if (n_sr)  sinrecibir.push({tid:t.id, n:n_sr});
    if (n_sc)  sinconvertir.push({tid:t.id, n:n_sc});
  }
  const top5 = arr => arr.sort((x,y) => y.n - x.n).slice(0,5);
  return {
    invictos: top5(invictos),
    singanar: top5(singanar),
    sinrecibir: top5(sinrecibir),
    sinconvertir: top5(sinconvertir),
  };
}

// --- CONTINENTAL: para cada equipo argentino, su próximo partido de copa
function deriveContinental(libFixtures, sudFixtures, teamMap){
  const out = {};
  const now = Date.now();
  const horizonMs = 14 * 86400 * 1000;  // 14 días adelante

  const process = (fixtures, comp, sigla) => {
    for (const fx of fixtures || []){
      const dt = new Date(fx.fixture.date).getTime();
      if (dt < now - 86400000 || dt > now + horizonMs) continue;
      const home = teamMap.get(fx.teams.home.id);
      const away = teamMap.get(fx.teams.away.id);
      if (home && !out[home]){
        out[home] = { comp, sigla, dayLabel: formatDay(new Date(dt)), opp: fx.teams.away.name, home: true };
      }
      if (away && !out[away]){
        out[away] = { comp, sigla, dayLabel: formatDay(new Date(dt)), opp: fx.teams.home.name, home: false };
      }
    }
  };
  process(libFixtures, 'lib', 'LIB');
  process(sudFixtures, 'sud', 'SUD');
  return out;
}

// --- TEAM FIXTURES: para cada equipo, últimos 5 FT + próximos 3 NS.
// Es lo que alimenta la "página por equipo" del frontend.
function deriveTeamFixtures(fixtures, teamMap){
  const result = {};
  for (const t of TEAMS) result[t.id] = { recent: [], upcoming: [] };

  for (const fx of fixtures){
    if (!isGroupStage(fx)) continue;
    const hId = teamMap.get(fx.teams.home.id);
    const aId = teamMap.get(fx.teams.away.id);
    if (!hId && !aId) continue;
    const isFT = fx.fixture.status.short === 'FT';
    const date = new Date(fx.fixture.date).getTime();
    const round = getRoundNumber(fx);
    const dateLabel = `${formatDay(new Date(date))} · ${formatTime(new Date(date))}`;

    if (hId){
      const entry = {
        vs: aId, home: true,
        gf: isFT ? fx.goals.home : null,
        gc: isFT ? fx.goals.away : null,
        date: dateLabel,
        fecha: round,
        venue: fx.fixture.venue?.name || '',
        ref:   fx.fixture.referee || '',
        _ts: date,
      };
      (isFT ? result[hId].recent : result[hId].upcoming).push(entry);
    }
    if (aId){
      const entry = {
        vs: hId, home: false,
        gf: isFT ? fx.goals.away : null,
        gc: isFT ? fx.goals.home : null,
        date: dateLabel,
        fecha: round,
        venue: fx.fixture.venue?.name || '',
        ref:   fx.fixture.referee || '',
        _ts: date,
      };
      (isFT ? result[aId].recent : result[aId].upcoming).push(entry);
    }
  }

  for (const tid in result){
    result[tid].recent.sort((a,b) => b._ts - a._ts);   // más reciente primero
    result[tid].upcoming.sort((a,b) => a._ts - b._ts); // más próximo primero
    result[tid].recent   = result[tid].recent.slice(0, 5).map(e => (delete e._ts, e));
    result[tid].upcoming = result[tid].upcoming.slice(0, 10).map(e => (delete e._ts, e));
  }
  return result;
}

// =============================================================================
// HELPERS
// =============================================================================
function json(data, extraHeaders = {}, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    }
  });
}
