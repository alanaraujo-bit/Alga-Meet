# Music player v2: saved playlists, playlist links, mini player (2026-11-16)

## Why
The owner wants the call's music to feel premium: "foda, bonito, animado, fluido e sexy", no bugs. People keep their
own playlists, paste a YouTube playlist link, and shrink the player to a small, beautiful, draggable mini player that
can also live outside the Alga window. Nothing ships to production until the owner says so.

## Decided with the owner
- YouTube only (no Spotify matching).
- Music stays a call thing (everyone hears it together); no solo listening outside calls.
- No mockups: the owner handed over the look ("pode arrochar").

## Constraints
- YouTube's embedded player must stay visible, at least 200 × 200 px viewport, nothing drawn over the video.
  The mini player is therefore the video (356 × 200, 16:9) plus a slim control bar under it, never audio-only.
- No YouTube Data API key. Playlist ids come from YouTube's own embed: `embed/videoseries?list=ID&enablejsapi=1`
  reports `info.playlist` (array of video ids) over postMessage (probed 2026-11-16: 10/10 ids). Mixes (`RD…`) and
  private lists answer error 150: unsupported, said so.
- Titles and embeddability always come from the server's oEmbed lookup (never trusted from a client), cached in memory.
  oEmbed on a playlist URL gives the playlist's name.

## Approaches considered
1. **Client reads the list from the embed, server resolves and stores** (chosen): no key, no scraping, titles trusted.
2. YouTube Data API v3 on the server: clean, but needs a key, a quota (10k units/day) and a Google project.
3. Scrape `youtube.com/playlist` HTML on the server: fragile and against YouTube's terms.

## Design
- Shared: `MUSIC_QUEUE_MAX` 50 → 200; `youtubeListId()`; playlist limits (50 per person, 200 songs, name 80);
  `SavedPlaylist` types and zod bodies; gateway op `music_add_many { channelId, videoIds, replace, label }`
  (one rate token; server resolves in batches of 8, starts the first song as soon as it is known, skips unplayable);
  `last.kind` `'playlist'` with `count`.
- Server: table `music_playlists` (owner, name, items jsonb `{videoId,title,author}[]`), REST
  `GET/POST /music/playlists`, `PATCH/DELETE /music/playlists/:id`; oEmbed cache shared with the music queue.
- Client card, two tabs with a sliding indicator: **Tocando** (player, progress, controls, queue, "Salvar fila")
  and **Playlists** (cover mosaics; open one to play, shuffle, queue, rename, remove songs, delete).
  Pasting a playlist link shows a chip: play now / add to queue / save.
- **Revised the same day (owner's call):** minimized is a slim sound-only line (cover turning like a record, title,
  música anterior / tocar-pausar / avançar, volume on hover or scroll, a hair of progress); the same iframe keeps
  playing with opacity 0, never moved or reloaded. The owner chose this knowing YouTube's terms want the player visible
  (≥ 200 × 200) and that YouTube took down Discord music bots that played its audio alone (2021). "Música anterior"
  is new on the server: a call remembers 50 played songs; 3 s into a song it restarts it instead.
- Mini player (first version, superseded above): from the card's header. Inside Alga it floats, drags anywhere and springs to the nearest corner
  (remembered). "Destacar" moves it to a frameless, always-on-top window outside Alga (bounds remembered); the main
  window relays state and commands over IPC, and only one YouTube player plays at a time.

## Left to the builder
Exact motion curves, colors from the existing tokens, keyboard shortcuts inside the card, copy (pt-BR).
