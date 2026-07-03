# Liga Profesional · Datitos Worker

Worker de Cloudflare que sirve el frontend y un endpoint `/api/data` con todos los datos derivados de API-Football, cacheados en KV + edge cache.

## Estructura

```
worker/
├── wrangler.toml          # config del Worker (binding KV, vars, assets)
├── src/
│   └── index.js           # router + cliente API-Football + derivers
├── public/
│   └── index.html         # frontend que pega contra /api/data
└── README.md              # esto
```

## Setup inicial (una sola vez)

### 1. Instalar Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Crear el KV namespace

```bash
wrangler kv namespace create CACHE
```

Eso devuelve algo como:

```
{ binding = "CACHE", id = "abc123..." }
```

Copiá ese `id` y pegalo en `wrangler.toml` reemplazando `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

### 3. Guardar la API key como secret

```bash
wrangler secret put API_FOOTBALL_KEY
# te pide la key — pegala y enter
```

La key queda guardada cifrada del lado de Cloudflare. No se sube al repo, no se loguea, no se expone al frontend.

### 4. Verificar los IDs de las ligas

Antes del primer deploy, verificar que los IDs de `wrangler.toml` sean los correctos:

```bash
curl -H "x-apisports-key: $TU_KEY" \
  "https://v3.football.api-sports.io/leagues?country=Argentina"
```

Buscar:
- `Primera División` → debe coincidir con `LEAGUE_ID`
- `Copa Libertadores` → `COPA_LIB_ID`
- `Copa Sudamericana` → `COPA_SUD_ID`

Si difieren, ajustar `[vars]` en `wrangler.toml`.

### 5. Deploy

```bash
wrangler deploy
```

Te devuelve la URL pública (algo como `https://liga-datitos.<tu-subdomain>.workers.dev`). Abrila y debería decir **LIVE · datos vía Worker** en verde arriba.

## Testing local

```bash
wrangler dev
```

Sirve en `http://localhost:8787`. Las llamadas a la API real cuentan contra tu quota free igual.

Si querés desarrollar sin tocar la API, abrí `public/index.html` directo en el navegador — la página detecta que `/api/data` no responde y cae a datos de muestra automáticamente.

## Cómo funciona la caché

Dos capas:

1. **Edge cache** (Cloudflare). El response de `/api/data` se cachea por **5 min** en el edge de cada PoP. Si dos personas piden en 5 min, la segunda no toca ni el Worker.

2. **KV cache**. Las respuestas individuales de API-Football se guardan en KV con TTLs distintos:
   - `fixtures`: 10 min (cambia en vivo)
   - `scorers`: 1 hora
   - `copas`: 30 min
   - `teams`: 7 días

   Además se guardan con un *grace period* de 24h: si la API falla cuando toca refrescar, el Worker devuelve el valor vencido en vez de romper la página.

Resultado: en condiciones normales pegás a API-Football **~10 veces por hora** (1 cada 10 min para fixtures + ocasional para scorers/copas). Lejos del límite de 100/día del free tier.

## Modificaciones frecuentes

### Cambió la fecha o las zonas

Editá la constante `TEAMS` en `src/index.js` (línea ~35). Cada equipo tiene `zone: 'A'|'B'` y `region: 'amba'|'interior'`. Redeploy y listo.

### Cambió la lista de los 15 clásicos

Editá `CLASICOS` en `src/index.js` (línea ~75) con los pares de IDs locales.

### Promedios históricos

Los valores de `PROMEDIOS_HIST` están como demo. Para reemplazarlos con datos reales:

1. Bajar los fixtures de la temporada anterior con `wrangler kv key get` o calcularlos a mano
2. Actualizar el objeto con los puntos finales 2024 y 2025 por equipo
3. Redeploy

Esto se hace **una vez por año** al cerrar la temporada anterior.

### Cache manual / invalidación

Si querés forzar un refresh:

```bash
# Borrar todas las keys de caché
wrangler kv key list --binding CACHE | jq -r '.[].name' | \
  xargs -I {} wrangler kv key delete --binding CACHE {}
```

O esperar el TTL natural (máx 10 min).

## Pendientes / mejoras posibles (v2)

- **Tarjetas amarillas y rojas por árbitro**: requiere `/fixtures/events?fixture=ID` por partido. Como los eventos no cambian una vez FT, cachearlos *for ever* por fixture ID y un cron semanal que agregue los nuevos.
- **Cron Trigger** que pre-caliente la caché los lunes a la mañana, así el primer usuario del día encuentra el response listo.
- **Endpoint `/api/refresh`** protegido con un secret para forzar invalidación remota.
- **Logging estructurado** vía Workers Logs / Logpush si necesitás auditar.

## Troubleshooting

**El banner queda en DEMO aunque deployé.** Mirá la consola del navegador (F12). Probablemente `/api/data` está devolviendo error. Lo más común:
- API key inválida o no seteada como secret
- Los IDs de las ligas no son los correctos para tu plan (algunos planes free no incluyen todas las ligas — verificar en dashboard de api-sports.io)
- Sin equipos matcheados: en los logs del Worker (`wrangler tail`) vas a ver `Equipos sin matchear: [...]` con los nombres que vienen de la API. Agregalos al array `aliases` del equipo correspondiente en `TEAMS`.

**El response demora mucho la primera vez.** Es esperable: primer hit ejecuta las 4 llamadas en paralelo a API-Football. Esperá 1-3s. Los siguientes hits dentro de 5 min son <50ms (edge cache).
