// The Help page. Plain text: paragraphs are separated by a blank line and lines that start with "• " are list items. The English and Spanish versions have
// the same sections in the same order (a test checks it).
import type { Lang } from './i18n.js'

export interface HelpSection { id: string; title: string; body: string }

const en: HelpSection[] = [
  { id: 'about', title: 'What Quill is', body: `A small Nostr client made only of text, that tells you why it hides things.

• Nothing external is loaded: no images, video, link previews or profile pictures from other servers. Links are shown as text and only open when you tap them.
• It never sees your private key: to write, it asks your signer to sign.
• Nothing is hidden silently: every hidden note says which rule hid it, and one tap shows it.` },
  { id: 'read', title: 'Reading', body: `Sign in with your npub. There are three tabs:

• On a wide screen (a computer, about 1100 px or more) Following, Mentions and Me are shown side by side, each scrolling on its own, and a thread, an account or a list opens in a panel on the right (× closes it). Settings and Help take the whole page. On a phone it is one column with the tabs at the bottom.
• Following: notes of the people you follow (not their replies) and what they repost, marked “Ana reposted”. A repost does not vouch for the note: the filter judges it by its own author. You can switch reposts off in Settings.
• At the top of Following a switch chooses **Follows** (the people you follow) or **Network**: the notes of the people they follow, each marked “Followed by Ana and 3 more” so you can see why it is there. Network leaves out the “outside your network” rule (that is what it is showing you); every other rule applies. It looks at the accounts followed by the most of your follows, up to 200.
• Mentions: replies and mentions from anyone. This is where the filter works hardest.
• Disconnect and Sign out (in Me) are not the same, and both ask first. Disconnect only cuts the connection with your signer: you keep reading as your account, but you cannot react, reply or write until you connect it again. Sign out does that too and also makes Quill forget your account on this device, so it goes back to the login: to read again you paste your npub, and to write you pair the signer again. Use Sign out on a computer that is not yours.
• Me: your account (with how many you follow, exact, and about how many follow you, with a ~: there is no official count, relays each know only part of them, and every app counts in its own way, so it will not match other apps exactly), your signer connection, your own notes and sign out.

Tap a name, an avatar or an @mention to open that account: its profile as text (its pictures are never loaded), how many accounts it follows, whether you follow it and which of your follows do, and its notes, with a Notes | Replies switch. With a signer connected, its page has a Follow / Unfollow button. In Me, tap the number you follow or the number that follow you to see each list, newest first (yours is exact; the followers list is only the ones Quill has seen, so it matches the ~ count and is never official). Tap Thread on a note to see the whole conversation; tapping the text of a note does the same. The … on each note offers Copy note ID (a nostr:nevent… to paste into a note) and Copy note link (opens that note in Quill; someone with no account reads it as it is, with no filter, and can choose an account below). The ↻ button, or tapping the tab you are already on, reads everything again from the relays. When you come back to the app after a couple of minutes it refreshes by itself.` },
  { id: 'filter', title: 'How the filter decides', body: `Every note gets a verdict: shown or hidden, by which rule, and the numbers behind it. In order of priority:

• Muted account or word: you muted it. Applies to everybody.
• Repeated text: most of an account's notes are a text that other accounts also post (3 or more words, or a link).
• Burst: 5 or more notes in one minute.
• Link only: 3 or more notes, almost all with links.
• Outside your network: the account is further than N hops in the follow graph (2 by default: people you follow and the people they follow).

The last four never apply to you or to the people you follow. Missing data is never a reason: an account without a profile, or a follow graph that has not loaded yet, never hides anything by itself. A short greeting repeated by many accounts is a greeting, not spam.

The summary at the top says how many notes are hidden and why. Every rule can be switched off in Settings (⚙), where you can also mute words.` },
  { id: 'write', title: 'Writing with a signer', body: `In Me, tap Connect a signer and paste the bunker:// address your signer gives you (Clave, a bunker of your own, or any other that speaks NIP-46; or tap Paste and connect after copying it there). The signer keeps your key and signs; Quill only keeps an app key in this browser. Each new connection starts with a fresh app key, so you can connect again after deleting the connection in the signer.

• With a bunker:// address a phone signer such as Clave can sign in the background. With a link or QR it only answers while it is open on screen.
• Reacting is one tap: three reactions are always at hand and the + next to them opens the rest (one you already gave always stays visible). Sharing a note (the arrows button) asks first, because it is public and Quill cannot undo it: you see the note, then confirm. Only notes the filter shows can be shared, and what you already shared is lit. The same panel offers Quote with a comment: a note of your own with your comment and a reference to the original (the author is told), which cannot be sent without a comment. Reply and Write a note go through a review screen that shows the exact text, kind, tags and relays before anything is asked of your signer.
• On a wide screen the box where you write has a 🙂 button that opens a grid of emojis; tap one to put it where the cursor is. A phone has its own emoji keyboard, so it is not shown there.
• Quill sends one request and waits up to 90 seconds. You can cancel, and nothing is published unless your signer signs.
• Quill signs at most 20 times per hour, notes up to 1000 characters, whatever trust level you set in your signer. In Clave, a good level for Quill is medium.
• Follow and Unfollow replace your whole PUBLIC follow list, so Quill is careful: it reads your newest list from the relays right then, refuses if none is found or if it is much shorter than the one it had seen (a stale copy could erase follows), shows you exactly what changes (from N to N+1 accounts), reads the list again just before signing, and publishes your list exactly as it is with ONE account added or removed. Your signer can ask you each time, and Quill keeps a copy of your previous list on this device.
• After signing, the result is shown relay by relay, with a retry for the ones that failed that needs no new signature.` },
  { id: 'marks', title: 'What you already did', body: `• A reaction you already gave is lit under the note (also ones you gave from other apps). Tapping it again does nothing: it would only be a duplicate.
• A note you already replied to says Replied, with a tick.` },
  { id: 'news', title: 'What is new', body: `While the app is open it looks once a minute and shows a number on the Mentions tab (up to 9+) with what is new since you last opened it: replies, mentions, reactions and reposts of your notes.

• Opening Mentions marks the new notes and lists who reacted to your notes and who reposted them.
• New followers are announced too: accounts that follow you now and did not the last time you looked. Quill cannot know WHEN they followed you, and each relay knows only some of your followers, so a follower may take a while to show up. Somebody counts as a follower only if their NEWEST follow list names you (a relay with an old copy does not make them one), and who stops following you is noticed and no longer counted (this is checked every half hour or so). The first time it only learns who follows you, without announcing anyone.
• What the filter would hide is not counted in the number; it is listed apart.
• There are no system notifications: nothing reaches you while the app is closed.` },
  { id: 'settings', title: 'Settings', body: `Open them with the cog (⚙) next to the language buttons.

• Text size: four sizes, remembered on this device.
• Halloween theme: purple and pumpkin colours, a pumpkin and a cobweb in the header, spooky wording and 🎃 👻 🦇 💀 🕷️ among the reactions. It turns on by itself from 24 October to 1 November; the switch in Settings always wins, on or off, and Quill remembers it.
• In Me, under each note of yours, small numbers show what it got from other people: the reactions (up to three emojis with their count and the rest as +N), the reposts and the replies (a quote counts as a reply). It does not count you or accounts you muted, and each person counts once. The numbers come a moment after the notes, from what the relays show.
• Avatars: initials on a colour (the default), robots, pixel figures or Halloween creatures (pumpkins, ghosts, bats, skulls, black cats, spiders and witches). The robots, the figures and the creatures are drawn from each account's key, so the same account always looks the same; nothing is loaded from anywhere.
• Relays: the relays Quill reads from and publishes to. Only secure addresses (wss://), from 1 to 10. Test tells you if one answers, and you can restore the defaults. Every relay sees your IP address and what you publish. A signer such as Clave uses its own relays and is not affected.
• Relay list on Nostr: you can publish your list so that other apps and your other devices know it. It is public, so Quill asks you to confirm and your signer may ask you to approve it. A device where you never chose a list starts from the one you published (once; after that it is that device's own list).
• Filter: the rules, how far your network reaches and the muted words.` },
  { id: 'install', title: 'Install it as an app', body: `• iPhone (Safari): Share, then Add to Home Screen.
• Android (Chrome): menu, then Install app.

Installed, it opens full screen with its own icon. It keeps its own data, separate from the browser, so you sign in and connect your signer again inside it. When there is a new version a bar appears with an Update button.` },
  { id: 'trouble', title: 'If something does not work', body: `• The feed does not load: tap ↻. If it keeps failing, open Settings (⚙) and use Test on your relays; remove the ones that do not answer.
• The signer does not sign: connect with a bunker:// address, open the signer (Clave, for example) and tap again (a new tap replaces the pending wait). If you deleted the connection in the signer, disconnect in Me and connect again.
• You changed something on another device: relays and text size are kept per device.
• An installed app looks old: when a new version exists, tap Update in the bar at the top.` },
]

const es: HelpSection[] = [
  { id: 'about', title: 'Qué es Quill', body: `Un cliente pequeño de Nostr hecho solo de texto, que te dice por qué oculta cosas.

• No se carga nada externo: ni imágenes, ni vídeo, ni vistas previas de enlaces, ni fotos de perfil de otros servidores. Los enlaces se muestran como texto y solo se abren cuando los tocas.
• Nunca ve tu clave privada: para escribir, le pide a tu firmador que firme.
• Nada se oculta en silencio: cada nota oculta dice qué regla la ocultó, y con un toque se muestra.` },
  { id: 'read', title: 'Leer', body: `Entra con tu npub. Hay tres pestañas:

• En una pantalla ancha (un ordenador, unos 1100 px o más) Siguiendo, Menciones y Yo se muestran una al lado de otra, cada una con su propio desplazamiento, y un hilo, una cuenta o una lista se abre en un panel a la derecha (× lo cierra). Ajustes y Ayuda ocupan toda la página. En un móvil es una sola columna con las pestañas abajo.
• Siguiendo: notas de la gente que sigues (sin sus respuestas) y lo que comparten, marcado «Ana compartió». Un repost no avala la nota: el filtro la juzga por su propio autor. Puedes desactivar los reposts en Ajustes.
• Arriba de Siguiendo, un interruptor elige **Seguidos** (la gente que sigues) o **Red**: las notas de la gente a la que ellos siguen, cada una marcada «Seguida por Ana y 3 más» para que veas por qué está ahí. Red deja fuera la regla «fuera de tu red» (es justo lo que enseña); el resto de reglas se aplican. Mira las cuentas seguidas por más de tus seguidos, hasta 200.
• Menciones: respuestas y menciones de cualquiera. Aquí es donde más trabaja el filtro.
• Desconectar y Salir (en Yo) no son lo mismo, y los dos preguntan antes. Desconectar solo corta la conexión con tu firmador: sigues leyendo como tu cuenta, pero no puedes reaccionar, responder ni escribir hasta que la conectes otra vez. Salir hace eso y además hace que Quill olvide tu cuenta en este dispositivo, así que vuelve a la pantalla de entrada: para leer pegas tu npub otra vez, y para escribir tienes que emparejar el firmador de nuevo. Usa Salir en un ordenador que no sea tuyo.
• Yo: tu cuenta (con a cuántos sigues, exacto, y aproximadamente cuántos te siguen, con una ~: no hay un contador oficial, cada relé conoce solo una parte y cada app cuenta a su manera, así que no coincidirá exactamente con otras apps), tu conexión con el firmador, tus propias notas y cerrar sesión.

Toca un nombre, un avatar o una @mención para abrir esa cuenta: su perfil como texto (sus imágenes nunca se cargan), a cuántas cuentas sigue, si la sigues y cuáles de tus seguidos la siguen, y sus notas, con un interruptor Notas | Respuestas. Con un firmador conectado, su página tiene un botón Seguir / Dejar de seguir. En Yo, toca el número de los que sigues o el de los que te siguen para ver cada lista, la más reciente primero (la tuya es exacta; la de seguidores son solo los que Quill ha visto, así que coincide con la cuenta con ~ y nunca es oficial). Toca Hilo en una nota para ver toda la conversación; tocar el texto de una nota hace lo mismo. Los … de cada nota ofrecen Copiar ID de la nota (un nostr:nevent… para pegar en una nota) y Copiar enlace de la nota (abre esa nota en Quill; quien no tenga cuenta la lee tal cual, sin filtro, y puede elegir una cuenta debajo). El botón ↻, o tocar la pestaña en la que ya estás, vuelve a leer todo de los relés. Al volver a la app pasados un par de minutos se actualiza sola.` },
  { id: 'filter', title: 'Cómo decide el filtro', body: `Cada nota recibe un veredicto: visible u oculta, por qué regla y con qué números. Por orden de prioridad:

• Cuenta o palabra silenciada: la silenciaste tú. Vale para todo el mundo.
• Texto repetido: la mayoría de las notas de una cuenta son un texto que también publican otras cuentas (3 o más palabras, o un enlace).
• Ráfaga: 5 o más notas en un minuto.
• Solo enlaces: 3 o más notas, casi todas con enlaces.
• Fuera de tu red: la cuenta está a más de N saltos en el grafo de seguimiento (2 por defecto: la gente que sigues y la que ellos siguen).

Las cuatro últimas nunca se aplican a ti ni a la gente que sigues. La falta de datos nunca es un motivo: una cuenta sin perfil, o un grafo de seguimiento que aún no ha cargado, nunca ocultan nada por sí solos. Un saludo corto repetido por muchas cuentas es un saludo, no spam.

El resumen de arriba dice cuántas notas se ocultan y por qué. Cada regla se puede apagar en Ajustes (⚙), donde también puedes silenciar palabras.` },
  { id: 'write', title: 'Escribir con un firmador', body: `En Yo, toca Conectar firmador y pega la dirección bunker:// que te da tu firmador (Clave, un bunker propio u otro que hable NIP-46; o toca Pegar y conectar después de copiarla allí). El firmador guarda tu clave y firma; Quill solo guarda una clave de aplicación en este navegador. Cada conexión nueva empieza con una clave de aplicación nueva, así que puedes volver a conectar después de borrar la conexión en el firmador.

• Con una dirección bunker:// un firmador de móvil como Clave puede firmar en segundo plano. Con un enlace o un QR solo contesta mientras está abierta en pantalla.
• Reaccionar es un toque: tres reacciones están siempre a mano y el + de al lado abre el resto (una que ya diste siempre queda visible). Compartir una nota (el botón de las flechas) pregunta antes, porque es público y Quill no puede deshacerlo: ves la nota y confirmas. Solo se pueden compartir las notas que el filtro muestra, y lo que ya compartiste queda encendido. El mismo panel ofrece Citar con un comentario: una nota tuya con tu comentario y una referencia a la original (se avisa al autor), que no se puede enviar sin comentario. Responder y Escribir una nota pasan por una pantalla de revisión que muestra el texto exacto, el tipo, las etiquetas y los relés antes de pedirle nada a tu firmador.
• En una pantalla ancha el recuadro donde escribes tiene un botón 🙂 que abre una cuadrícula de emojis; toca uno para ponerlo donde esté el cursor. Un móvil tiene su propio teclado de emojis, así que ahí no se muestra.
• Quill manda una petición y espera hasta 90 segundos. Puedes cancelar, y no se publica nada si tu firmador no firma.
• Quill firma como mucho 20 veces por hora, notas de hasta 1000 caracteres, sea cual sea el nivel de confianza que le des en tu firmador. En Clave, un buen nivel para Quill es el medio.
• Seguir y Dejar de seguir sustituyen tu lista de seguidos ENTERA, que es PÚBLICA, así que Quill es cuidadoso: lee tu lista más reciente de los relés en ese momento, se niega si no encuentra ninguna o si es mucho más corta que la que había visto (una copia vieja podría borrar seguidos), te muestra exactamente qué cambia (de N a N+1 cuentas), vuelve a leer la lista justo antes de firmar y publica tu lista tal cual con UNA cuenta añadida o quitada. Tu firmador puede preguntarte cada vez, y Quill guarda una copia de tu lista anterior en este dispositivo.
• Tras firmar, el resultado se muestra relé por relé, con un reintento para los que fallaron que no necesita una firma nueva.` },
  { id: 'marks', title: 'Lo que ya has hecho', body: `• Una reacción que ya diste queda encendida bajo la nota (también las que diste desde otras apps). Tocarla otra vez no hace nada: solo sería un duplicado.
• Una nota que ya respondiste dice Respondida, con un check.` },
  { id: 'news', title: 'Qué hay de nuevo', body: `Con la app abierta mira una vez por minuto y muestra un número en la pestaña Menciones (hasta 9+) con lo nuevo desde la última vez que la abriste: respuestas, menciones, reacciones y reposts de tus notas.

• Al abrir Menciones se marcan las notas nuevas y se lista quién reaccionó a tus notas y quién las compartió.
• También avisa de los seguidores nuevos: cuentas que te siguen ahora y no te seguían la última vez que miraste. Quill no puede saber CUÁNDO empezaron a seguirte, y cada relé conoce solo a una parte de tus seguidores, así que alguno puede tardar en aparecer. Alguien cuenta como seguidor solo si su lista de seguidos MÁS RECIENTE te nombra (un relé con una copia vieja no lo convierte en uno), y quien deja de seguirte se detecta y deja de contarse (se comprueba cada media hora más o menos). La primera vez solo aprende quién te sigue, sin avisar de nadie.
• Lo que el filtro ocultaría no cuenta en el número; se lista aparte.
• No hay notificaciones del sistema: no te llega nada con la app cerrada.` },
  { id: 'settings', title: 'Ajustes', body: `Se abren con la rueda (⚙) junto a los botones de idioma.

• Tamaño del texto: cuatro tamaños, recordados en este dispositivo.
• Tema Halloween: colores morado y calabaza, una calabaza y una telaraña en la cabecera, textos de miedo y 🎃 👻 🦇 💀 🕷️ entre las reacciones. Se enciende solo del 24 de octubre al 1 de noviembre; el interruptor de Ajustes manda siempre, encendido o apagado, y Quill lo recuerda.
• En Yo, bajo cada nota tuya, unos números pequeños dicen lo que le han dado otras personas: las reacciones (hasta tres emojis con su cuenta y el resto como +N), los reposts y las respuestas (una cita cuenta como respuesta). No te cuenta a ti ni a las cuentas que silenciaste, y cada persona cuenta una vez. Los números llegan un momento después de las notas, con lo que muestran los relés.
• Avatares: iniciales sobre un color (por defecto), robots, figuras de píxeles o criaturas de Halloween (calabazas, fantasmas, murciélagos, calaveras, gatos negros, arañas y brujas). Los robots, las figuras y las criaturas se dibujan a partir de la clave de cada cuenta, así que la misma cuenta se ve siempre igual; no se carga nada de ningún sitio.
• Relés: los relés de los que Quill lee y en los que publica. Solo direcciones seguras (wss://), de 1 a 10. Probar te dice si uno responde, y puedes restaurar los de por defecto. Cada relé ve tu dirección IP y lo que publicas. Un firmador como Clave usa sus propios relés y no se ve afectado.
• Lista de relés en Nostr: puedes publicar tu lista para que otras apps y tus otros dispositivos la conozcan. Es pública, así que Quill te pide que confirmes y tu firmador puede pedirte que la apruebes. Un dispositivo donde nunca elegiste lista empieza con la que publicaste (una sola vez; después es la lista de ese dispositivo).
• Filtro: las reglas, hasta dónde llega tu red y las palabras silenciadas.` },
  { id: 'install', title: 'Instálala como app', body: `• iPhone (Safari): Compartir y después Añadir a pantalla de inicio.
• Android (Chrome): menú y después Instalar app.

Una vez instalada se abre a pantalla completa con su icono. Guarda sus propios datos, separados del navegador, así que tendrás que entrar y conectar tu firmador otra vez dentro de ella. Cuando hay una versión nueva aparece una barra con un botón Actualizar.` },
  { id: 'trouble', title: 'Si algo no funciona', body: `• El feed no carga: toca ↻. Si sigue fallando, abre Ajustes (⚙) y usa Probar en tus relés; quita los que no respondan.
• El firmador no firma: conecta con una dirección bunker://, abre el firmador (Clave, por ejemplo) y toca otra vez (un toque nuevo sustituye a la espera pendiente). Si borraste la conexión en el firmador, desconecta en Yo y vuelve a conectar.
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
