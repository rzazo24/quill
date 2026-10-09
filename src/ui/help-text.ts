// The Help page. Plain text: paragraphs are separated by a blank line and lines that start with "• " are list items. The English and Spanish versions have
// the same sections in the same order (a test checks it).
import type { Lang } from './i18n.js'

export interface HelpSection { id: string; title: string; body: string }

const en: HelpSection[] = [
  { id: 'about', title: 'What Quill is', body: `A small Nostr client made only of text, that tells you why it hides things.

• Nothing external is loaded: no images, video, link previews or profile pictures from other servers. Links are shown as text and only open when you tap them.
• It never sees your private key: to write, it asks your signer (Clave) to sign.
• Nothing is hidden silently: every hidden note says which rule hid it, and one tap shows it.` },
  { id: 'read', title: 'Reading', body: `Sign in with your npub. There are three tabs:

• Following: notes of the people you follow (not their replies) and what they repost, marked “Ana reposted”. A repost does not vouch for the note: the filter judges it by its own author. You can switch reposts off in Settings.
• Mentions: replies and mentions from anyone. This is where the filter works hardest.
• Me: your account, your Clave connection, your own notes and sign out.

Tap Thread on a note to see the whole conversation. The ↻ button, or tapping the tab you are already on, reads everything again from the relays. When you come back to the app after a couple of minutes it refreshes by itself.` },
  { id: 'filter', title: 'How the filter decides', body: `Every note gets a verdict: shown or hidden, by which rule, and the numbers behind it. In order of priority:

• Muted account or word: you muted it. Applies to everybody.
• Repeated text: most of an account's notes are a text that other accounts also post (3 or more words, or a link).
• Burst: 5 or more notes in one minute.
• Link only: 3 or more notes, almost all with links.
• Outside your network: the account is further than N hops in the follow graph (2 by default: people you follow and the people they follow).

The last four never apply to you or to the people you follow. Missing data is never a reason: an account without a profile, or a follow graph that has not loaded yet, never hides anything by itself. A short greeting repeated by many accounts is a greeting, not spam.

The summary at the top says how many notes are hidden and why. Every rule can be switched off in Settings (⚙), where you can also mute words.` },
  { id: 'write', title: 'Writing with Clave', body: `In Me, tap Connect Clave and paste the bunker:// address that Clave gives you (or tap Paste and connect after copying it in Clave). Clave keeps your key and signs; Quill only keeps an app key in this browser.

• With a bunker:// address Clave can sign in the background. With a link or QR it only answers while it is open on screen.
• Reacting is one tap. Reply and Write a note go through a review screen that shows the exact text, kind, tags and relays before anything is asked of Clave.
• Quill sends one request and waits up to 90 seconds. You can cancel, and nothing is published unless Clave signs.
• Quill signs at most 20 times per hour, notes up to 1000 characters, whatever trust level you set in Clave. A good level for Quill in Clave is medium.
• After signing, the result is shown relay by relay, with a retry for the ones that failed that needs no new signature.` },
  { id: 'marks', title: 'What you already did', body: `• A reaction you already gave is lit under the note (also ones you gave from other apps). Tapping it again does nothing: it would only be a duplicate.
• A note you already replied to says Replied, with a tick.` },
  { id: 'news', title: 'What is new', body: `While the app is open it looks once a minute and shows a number on the Mentions tab (up to 9+) with what is new since you last opened it: replies, mentions and reactions to your notes.

• Opening Mentions marks the new notes and lists who reacted to your notes.
• What the filter would hide is not counted in the number; it is listed apart.
• There are no system notifications: nothing reaches you while the app is closed.` },
  { id: 'settings', title: 'Settings', body: `Open them with the cog (⚙) next to the language buttons.

• Text size: four sizes, remembered on this device.
• Relays: the relays Quill reads from and publishes to. Only secure addresses (wss://), from 1 to 10. Test tells you if one answers, and you can restore the defaults. Every relay sees your IP address and what you publish. Clave uses its own relays and is not affected.
• Relay list on Nostr: you can publish your list so that other apps and your other devices know it. It is public, so Quill asks you to confirm and Clave asks you to approve it. A device where you never chose a list starts from the one you published (once; after that it is that device's own list).
• Filter: the rules, how far your network reaches and the muted words.` },
  { id: 'install', title: 'Install it as an app', body: `• iPhone (Safari): Share, then Add to Home Screen.
• Android (Chrome): menu, then Install app.

Installed, it opens full screen with its own icon. It keeps its own data, separate from the browser, so you sign in and connect Clave again inside it. When there is a new version a bar appears with an Update button.` },
  { id: 'trouble', title: 'If something does not work', body: `• The feed does not load: tap ↻. If it keeps failing, open Settings (⚙) and use Test on your relays; remove the ones that do not answer.
• Clave does not sign: connect with a bunker:// address, open Clave and tap again (a new tap replaces the pending wait).
• You changed something on another device: relays and text size are kept per device.
• An installed app looks old: when a new version exists, tap Update in the bar at the top.` },
]

const es: HelpSection[] = [
  { id: 'about', title: 'Qué es Quill', body: `Un cliente pequeño de Nostr hecho solo de texto, que te dice por qué oculta cosas.

• No se carga nada externo: ni imágenes, ni vídeo, ni vistas previas de enlaces, ni fotos de perfil de otros servidores. Los enlaces se muestran como texto y solo se abren cuando los tocas.
• Nunca ve tu clave privada: para escribir, le pide a tu firmador (Clave) que firme.
• Nada se oculta en silencio: cada nota oculta dice qué regla la ocultó, y con un toque se muestra.` },
  { id: 'read', title: 'Leer', body: `Entra con tu npub. Hay tres pestañas:

• Siguiendo: notas de la gente que sigues (sin sus respuestas) y lo que comparten, marcado «Ana compartió». Un repost no avala la nota: el filtro la juzga por su propio autor. Puedes desactivar los reposts en Ajustes.
• Menciones: respuestas y menciones de cualquiera. Aquí es donde más trabaja el filtro.
• Yo: tu cuenta, tu conexión con Clave, tus propias notas y cerrar sesión.

Toca Hilo en una nota para ver toda la conversación. El botón ↻, o tocar la pestaña en la que ya estás, vuelve a leer todo de los relés. Al volver a la app pasados un par de minutos se actualiza sola.` },
  { id: 'filter', title: 'Cómo decide el filtro', body: `Cada nota recibe un veredicto: visible u oculta, por qué regla y con qué números. Por orden de prioridad:

• Cuenta o palabra silenciada: la silenciaste tú. Vale para todo el mundo.
• Texto repetido: la mayoría de las notas de una cuenta son un texto que también publican otras cuentas (3 o más palabras, o un enlace).
• Ráfaga: 5 o más notas en un minuto.
• Solo enlaces: 3 o más notas, casi todas con enlaces.
• Fuera de tu red: la cuenta está a más de N saltos en el grafo de seguimiento (2 por defecto: la gente que sigues y la que ellos siguen).

Las cuatro últimas nunca se aplican a ti ni a la gente que sigues. La falta de datos nunca es un motivo: una cuenta sin perfil, o un grafo de seguimiento que aún no ha cargado, nunca ocultan nada por sí solos. Un saludo corto repetido por muchas cuentas es un saludo, no spam.

El resumen de arriba dice cuántas notas se ocultan y por qué. Cada regla se puede apagar en Ajustes (⚙), donde también puedes silenciar palabras.` },
  { id: 'write', title: 'Escribir con Clave', body: `En Yo, toca Conectar Clave y pega la dirección bunker:// que te da Clave (o toca Pegar y conectar después de copiarla en Clave). Clave guarda tu clave y firma; Quill solo guarda una clave de aplicación en este navegador.

• Con una dirección bunker:// Clave puede firmar en segundo plano. Con un enlace o un QR solo contesta mientras está abierta en pantalla.
• Reaccionar es un toque. Responder y Escribir una nota pasan por una pantalla de revisión que muestra el texto exacto, el tipo, las etiquetas y los relés antes de pedirle nada a Clave.
• Quill manda una petición y espera hasta 90 segundos. Puedes cancelar, y no se publica nada si Clave no firma.
• Quill firma como mucho 20 veces por hora, notas de hasta 1000 caracteres, sea cual sea el nivel de confianza que le des en Clave. Un buen nivel para Quill en Clave es el medio.
• Tras firmar, el resultado se muestra relé por relé, con un reintento para los que fallaron que no necesita una firma nueva.` },
  { id: 'marks', title: 'Lo que ya has hecho', body: `• Una reacción que ya diste queda encendida bajo la nota (también las que diste desde otras apps). Tocarla otra vez no hace nada: solo sería un duplicado.
• Una nota que ya respondiste dice Respondida, con un check.` },
  { id: 'news', title: 'Qué hay de nuevo', body: `Con la app abierta mira una vez por minuto y muestra un número en la pestaña Menciones (hasta 9+) con lo nuevo desde la última vez que la abriste: respuestas, menciones y reacciones a tus notas.

• Al abrir Menciones se marcan las notas nuevas y se lista quién reaccionó a tus notas.
• Lo que el filtro ocultaría no cuenta en el número; se lista aparte.
• No hay notificaciones del sistema: no te llega nada con la app cerrada.` },
  { id: 'settings', title: 'Ajustes', body: `Se abren con la rueda (⚙) junto a los botones de idioma.

• Tamaño del texto: cuatro tamaños, recordados en este dispositivo.
• Relés: los relés de los que Quill lee y en los que publica. Solo direcciones seguras (wss://), de 1 a 10. Probar te dice si uno responde, y puedes restaurar los de por defecto. Cada relé ve tu dirección IP y lo que publicas. Clave usa sus propios relés y no se ve afectada.
• Lista de relés en Nostr: puedes publicar tu lista para que otras apps y tus otros dispositivos la conozcan. Es pública, así que Quill te pide que confirmes y Clave te pide que la apruebes. Un dispositivo donde nunca elegiste lista empieza con la que publicaste (una sola vez; después es la lista de ese dispositivo).
• Filtro: las reglas, hasta dónde llega tu red y las palabras silenciadas.` },
  { id: 'install', title: 'Instálala como app', body: `• iPhone (Safari): Compartir y después Añadir a pantalla de inicio.
• Android (Chrome): menú y después Instalar app.

Una vez instalada se abre a pantalla completa con su icono. Guarda sus propios datos, separados del navegador, así que tendrás que entrar y conectar Clave otra vez dentro de ella. Cuando hay una versión nueva aparece una barra con un botón Actualizar.` },
  { id: 'trouble', title: 'Si algo no funciona', body: `• El feed no carga: toca ↻. Si sigue fallando, abre Ajustes (⚙) y usa Probar en tus relés; quita los que no respondan.
• Clave no firma: conecta con una dirección bunker://, abre Clave y toca otra vez (un toque nuevo sustituye a la espera pendiente).
• Cambiaste algo en otro dispositivo: los relés y el tamaño del texto se guardan en cada dispositivo.
• Una app instalada se ve antigua: cuando hay una versión nueva, toca Actualizar en la barra de arriba.` },
]

export const HELP: Record<Lang, HelpSection[]> = { en, es }

export type HelpBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] }
/** Paragraphs and bullet lists, in order. Text only: nothing here is ever treated as markup. */
export function helpBlocks(body: string): HelpBlock[] {
  const out: HelpBlock[] = []
  for (const para of body.split(/\n\s*\n/)) {
    let list: string[] | null = null
    for (const line of para.split('\n')) {
      if (line.startsWith('• ')) { (list ??= []).push(line.slice(2)); if (list.length === 1) out.push({ kind: 'ul', items: list }) } else {
        list = null; if (line.trim()) out.push({ kind: 'p', text: line.trim() })
      }
    }
  }
  return out
}
