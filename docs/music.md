# Música na call

Colar um link do YouTube na call e todo mundo ouve junto, no mesmo ponto da música, como os bots de música do
Discord.

## Por que assim

Os bots do Discord tiram o áudio do YouTube num servidor e mandam para a call. Isso viola os termos do YouTube, e foi
por isso que o Groovy e o Rythm, os maiores, foram fechados pelo Google em 2021. Aqui nenhum áudio passa pelo nosso
servidor: **cada app toca a música no player oficial do YouTube**, embutido, e o servidor só guarda a fila e o relógio
da música. Consequências, de propósito:

- o player fica à vista enquanto toca (os termos pedem no mínimo 200×200 e proíbem esconder ou tirar o áudio);
- os anúncios do YouTube aparecem para cada pessoa (depois de um anúncio, o player volta ao ponto da sala);
- vídeo com incorporação desligada pelo dono não entra (o servidor confere no oEmbed antes).

## O que a pessoa vê

- **Botão de nota** na barra da call (e Ctrl K › "Tocar música na call"): abre o cartão no canto inferior direito.
- **Colar um link** (watch, youtu.be, shorts, music.youtube.com, live) já adiciona. Se nada toca, começa em 0,8 s para
  todo mundo; senão, entra na fila (até 50).
- **Controles para todos na call:** tocar/pausar, pular, mudar o ponto, parar e limpar a fila, tirar da fila.
- **Só para você:** o volume (lembrado neste PC) e "Parar de ouvir", que tira o player do seu app; a call continua.
- **Sentado no cinema:** a música pausa só para você.
- A música da call acaba quando a call esvazia.

## Protocolo

| Frame | O quê |
|---|---|
| `music_hello {channelId}` | pede o estado da call (ao entrar, ao reconectar) |
| `music_add {channelId, url}` | link do YouTube; 5 seguidos e depois 1 a cada 2 s |
| `music_control {channelId, action, position?}` | `play`, `pause`, `seek`, `skip`, `stop` |
| `music_remove {channelId, trackId}` | tira da fila |
| `music_report {channelId, trackId, kind, durationS?}` | o player viu: `duration`, `ended`, `unplayable` (removido ou privado) |

O servidor responde com `MUSIC_STATE` para todos na call e `MUSIC_ERROR` para quem pediu. Só aceita de quem está na
call (pelo estado de voz do próprio servidor). Se ninguém avisar o fim, o servidor avança sozinho 2,5 s depois do fim
conhecido. Um "ended" antes da hora é ignorado. Contrato: `packages/shared/src/music.ts`.

## Detalhes do player

- Controlado só por `postMessage` (a política de conteúdo do app não carrega o script do YouTube): `logic.ts`.
- O app em produção carrega de `file://`, que não manda `Referer`, e o YouTube recusa o player sem ele (erro 153).
  O processo principal manda o endereço da nossa API como `Referer` só no documento do player
  (`apps/desktop/src/main/music-logic.ts`). Um IP é recusado (erro 150): API local por IP vira `localhost`.
- Erros 101/150/153 na hora de tocar são do app (o servidor já conferiu a incorporação) e só aparecem para ele; só
  2/5/100 pulam a música para todos.
- A cada 0,5 s o player compara o próprio tempo com o da sala; mais de 1,5 s de diferença, ele pula para lá.

## Testes

- `packages/shared/src/music.test.ts`, `apps/server/test/music.test.ts` (também em PostgreSQL real),
  `apps/desktop/src/main/music-logic.test.ts`, `apps/desktop/src/renderer/src/features/music/{logic,store}.test.ts`.
- Ponta a ponta com vídeos reais (precisa de internet):
  `QA_WORK=<pasta> QA_API_PORT=4390 QA_LK_PORT=7990 node apps/desktop/scripts/music-e2e.mjs`.

## Deploy

API antes do desktop. Um app novo contra uma API antiga não mostra o botão (o READY não diz `music: true`).
