# Quill

**[English](README.md) · [Español](README.es.md)**

Un cliente pequeño de [Nostr](https://nostr.com), **pensado primero para el texto**, que **te dice por qué oculta cosas**.

En marcha en **<https://quill.hivescope.xyz>**. Pega un `npub` para leer; conecta un firmador ([Clave](https://clave.casa) en iPhone) para reaccionar, responder y escribir. Quill nunca ve tu clave privada.

## Tres promesas

1. **El texto primero.** No se carga nada externo: ni imágenes, ni vídeo, ni vistas previas de enlaces, ni fotos de perfil de otros servidores (los avatares se dibujan a partir de la clave y el nombre de la cuenta). Los enlaces se muestran como texto con la dirección completa a la vista, y solo se abren cuando haces clic. Lo hace cumplir el navegador, no solo el código: la página lleva una política de seguridad (CSP) que permite su propio script, estilo e iconos, y conexiones `wss://` a los relés, y nada más.
2. **Ligero.** Una página estática, sin servidor propio, con unos 60 KB de JavaScript (comprimido).
3. **Un filtro que se explica.** Nada se oculta en silencio. Cada nota oculta se pliega en una línea que dice qué regla la ocultó y qué vio la regla, y con un toque se muestra. Un contador te dice cuánto se ocultó y por qué.

## Cómo decide el filtro

Cada nota recibe un *veredicto* (`src/core/verdict.ts`): visible u oculta, por qué regla y con qué números. Por orden de prioridad:

| Regla | Oculta cuando | No se aplica nunca a |
|---|---|---|
| cuenta o palabra silenciada | tú la silenciaste | — |
| texto repetido | la mayoría de las notas de una clave son un texto que también publican otras claves (3 o más palabras, o un enlace) | tú, la gente que sigues |
| ráfaga | 5 o más notas en un minuto | tú, la gente que sigues |
| solo enlaces | 3 o más notas, casi todas con enlaces | tú, la gente que sigues |
| fuera de tu red | a más de N saltos en el grafo de seguimiento (por defecto 2) | tú, la gente que sigues |

Principios: la conducta es una prueba, **la falta de datos no lo es** (una clave sin perfil, o un grafo de seguimiento que aún no ha cargado, nunca ocultan nada por sí solos); a quien tú elegiste nunca se le oculta por su conducta; un saludo corto repetido por muchas claves es un saludo, no spam. Cada regla se puede apagar. Las reglas salen del triaje de [nostrclaw](https://github.com/rzazo24/nostrclaw).

## Qué hace

- **Siguiendo**, **Menciones** (donde el filtro se gana el sueldo), **Yo** (tu cuenta, tu conexión con Clave, los ajustes del filtro y tus propias notas) y cualquier **hilo**.
- **Reaccionar** con un toque; **responder** y **escribir una nota** con una pantalla de revisión que muestra el texto exacto, el tipo, las etiquetas y los relés antes de pedirle nada al firmador.
- Inglés y español; tema oscuro; pensado primero para móvil, y también cómodo en un ordenador.
- Instalable como app en iPhone y Android.

### Lo que no hace (a propósito, o todavía)

Ni mensajes directos, ni zaps, ni búsqueda, ni listas, ni multimedia, ni artículos largos. La lista de relés es fija (seis relés públicos), no se lee por autor (NIP-65). Sin notificaciones del sistema (necesitarían un service worker y avisos push). Sin modo sin conexión: las notas llegan en vivo de los relés, así que una copia guardada solo mostraría una pantalla vacía.

## Escribir: Quill nunca ve tu clave privada

*Conectar Clave* te pide que pegues la **dirección `bunker://`** que te da Clave (o que pulses *Pegar y conectar* después de copiarla en Clave). Clave guarda la clave y firma; Quill solo guarda una clave de aplicación, en este navegador, que lo identifica ante Clave.

**Por qué `bunker://` y no un enlace:** Clave firma en segundo plano solo para clientes emparejados así (su servicio de avisos la despierta para las peticiones que llegan por `relay.powr.build`). Con un enlace o un QR `nostrconnect://`, probado en un iPhone, Clave solo contestaba con la app abierta en pantalla. El enlace sigue ofrecido como alternativa (*Usar un enlace en su lugar*).

- Quill manda **una** petición al firmador (una sola notificación) y espera hasta 90 segundos, con un botón Cancelar; no se publica nada si el firmador no firma. Un toque nuevo sustituye a una petición que siga esperando.
- Lo que vuelve se **verifica**: firma válida, tu clave, y exactamente el tipo, el contenido y las etiquetas que se pidieron (un firmador que añade una mención oculta es rechazado). Después publica en los relés y muestra el resultado **relé por relé**, con un reintento para los que fallaron que no necesita una firma nueva.
- La política propia de Quill solo firma notas (hasta 1000 caracteres) y reacciones, como mucho 20 firmas por hora, **sea cual sea el nivel de confianza que le des en el firmador**. Nivel sugerido para Quill en Clave: *medio* (aprueba solo los tipos 1, 6 y 7, que es todo lo que Quill necesita); *completo* también aprobaría borrados, listas de seguidos y de relés, que Quill nunca pide.
- Un firmador de una cuenta distinta de la que estás leyendo se rechaza y se desconecta.

## Instálala como app

- **iPhone (Safari):** Compartir → Añadir a pantalla de inicio.
- **Android (Chrome):** menú → Instalar app.

Una vez instalada se abre a pantalla completa con su icono. **Guarda sus propios datos**, separados del navegador: tendrás que volver a entrar y a conectar tu firmador dentro de ella. No hay «tirar para recargar»: usa el botón **↻**, pulsa otra vez la pestaña actual, o vuelve pasados unos minutos (se actualiza sola a los dos).

**Las versiones nuevas se anuncian solas.** Cada compilación tiene un identificador, publicado en `/version.json`; la app lo compara con el suyo al arrancar, al volver a ella y cada diez minutos, y muestra una barra *Actualizar* cuando difieren (el botón solo recarga la página).

## Desarrollo

```bash
npm install
npm test            # pruebas unitarias y de integración (la del firmador contra un relé real se omite sin RELAY_BIN)
npm run build       # comprobación de tipos + compilación de producción
npm run dev
```

Comprobaciones en navegadores reales (Chromium de Playwright), sobre `npm run build`:

```bash
node test/e2e.mjs <npub>               # todo el flujo de lectura contra los relés reales
npm run e2e:sign                       # el apretón de manos de conexión con un Clave simulado (QUILL_URL=… prueba una copia desplegada)
npm run e2e:pwa                        # ¿es instalable?, ¿está bien el manifiesto?, ¿funciona el aviso de versión?
node test/e2e-shell.mjs <clave hex>    # la estructura: la página no se desplaza, solo el contenido; la barra de pestañas no se mueve
node test/e2e-align.mjs <clave hex>    # alineación en escritorio con barras de desplazamiento clásicas visibles
npm run probe -- <npub>                # la capa de datos contra los relés reales: qué haría el filtro
```

Organización del código: `src/core` lógica pura (seguridad del texto, hilos, el filtro) · `src/data` carga de seguidos, grafo, silenciados y listas · `src/net` el único código que habla con los relés (descarta eventos con firma mala o que no responden a lo que se pidió) · `src/sign` el firmador NIP-46, la política de firma y el flujo firmar-y-publicar · `src/ui` la página (DOM construido con `textContent`, nunca con `innerHTML`). `CLAUDE.md` recoge las reglas de diseño que no deben erosionarse y lo aprendido sobre iOS, Android y Clave.

### Despliegue

`scripts/deploy.sh <repo-del-relé> <dominio>` compila, copia `dist/` junto a un bloque de sitio de [Caddy](https://caddyserver.com) (`deploy/quill.caddy.template`, con cabeceras de seguridad estrictas), **valida toda la configuración de Caddy** y solo entonces la recarga; si la validación falla, restaura los archivos anteriores.

## Estado de la técnica

Mirado antes de empezar (octubre de 2026): Coracle oculta notas bajo un umbral de red de confianza sin decir por qué; nostui es un cliente de terminal sin filtro de spam.

Licencia MIT.
