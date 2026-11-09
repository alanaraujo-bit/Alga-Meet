# Novidades — como publicar as notas de cada versão

As notas de versão vivem no banco da API (`release_notes`), são escritas no próprio app (estúdio da equipe) e chegam às
pessoas em dois lugares: as **boas-vindas** depois de atualizar e a **Central de Novidades** (ícone de brilho na barra
da esquerda, ou Configurações › Avançado › Ver novidades). O texto do GitHub Release sai da mesma nota.

## O que cada pessoa vê

- Só notas **publicadas**, e só de versões **iguais ou anteriores à instalada** (`GET /releases?upTo=<versão do app>`).
  Uma nota publicada antes do release não aparece para ninguém até a pessoa ter aquela versão.
- **Boas-vindas** uma vez por versão, num momento calmo: fora de chamada (o que cobre transmissão e Cinema), sem jogo
  detectado, sem outra janela/diálogo aberto e com a janela em foco. "Entendi", × ou Esc marcam como visto;
  "Lembrar depois" volta em 24 h. Quem pulou versões vê as até 4 mais novas juntas. Conta criada há menos de um dia não
  vê boas-vindas (é o primeiro dia dela).
- O que já foi visto fica neste PC (`localStorage`, por conta), junto com uma cópia das notas para abrir sem servidor.
- **Atualização baixada** (electron-updater): pílula discreta "Atualização pronta" na barra de título, com o que vem
  na versão (se a nota já estiver publicada). "Reiniciar agora" fica indisponível durante chamada; se a pessoa não
  reiniciar, a versão entra ao fechar o app (`autoInstallOnAppQuit`).
- 👍/👎 por item: um voto por pessoa (chave primária `versão + item + pessoa`), muda ou desfaz quando quiser. A equipe vê
  só os totais no estúdio. Os votos saem na exportação de dados (LGPD) e somem com a conta.

## Fluxo de uma versão nova

1. **Rascunho.** Conta com `staff_role = admin` (`apps/server/scripts/grant-staff.ts`). No app: Novidades ›
   **Escrever novidades** › **Nova nota** (sugere a próxima versão). Rascunho é invisível para todos.
2. **Escrever.** Título da versão, resumo de uma frase e os itens (Novo / Melhoria / Correção, destaque ou não).
   Escreva o benefício para quem usa, curto, como a equipe falando com a comunidade. Destaques aparecem nas
   boas-vindas e como cartões grandes; os outros, em lista por categoria. A coluna da direita é a central ao vivo;
   **Ver boas-vindas** abre as boas-vindas de verdade, sem marcar nada como visto. `Ctrl+S` salva.
3. **Mídia (opcional).** Imagem, GIF ou vídeo curto (MP4/WebM, toca mudo e em loop só quando está na tela).
   Hospede como asset do release (`gh release upload vX.Y.Z demo.mp4`) e cole o link de download, ou use um arquivo do
   repositório público (`https://raw.githubusercontent.com/alanaraujo-bit/Alga-Meet/main/...`) — os dois tocam no app
   (testado). Para vídeo e GIF, informe o **quadro parado**: é o que aparece para quem prefere menos movimento.
   Preencha a **descrição da mídia** (leitores de tela). Link fora do ar vira "Mídia indisponível agora", sem buraco.
4. **Traduções (opcional).** Aba English/Español no estúdio. Campo vazio usa o português. Categorias, destaques e
   mídia valem para todos os idiomas; o app escolhe pelo idioma do Windows.
5. **Release no GitHub.** Fluxo de sempre (`docs/STATE.md` › Versão executável). Para o texto: **Copiar para o
   GitHub** no estúdio e `gh release create vX.Y.Z … --notes-file notas.md` (ou `gh release edit`). O estúdio mostra se
   o GitHub Release daquela versão já existe.
6. **Publicar.** Depois que o GitHub Release estiver publicado, **Publicar** no estúdio. Quem já atualizou vê as
   boas-vindas no próximo momento calmo; quem atualizar depois, ao abrir a versão nova. Dá para corrigir o texto
   depois (salvar numa nota publicada vale na hora). **Despublicar** tira da central e das boas-vindas e guarda os votos.
   Rascunho nunca publicado pode ser apagado.

O identificador de cada item (usado pelos votos) pode mudar até a primeira publicação; depois fica fixo.

## API

| Rota | Quem | O quê |
|---|---|---|
| `GET /releases?upTo=X.Y.Z` | logado | publicadas ≤ versão, mais nova primeiro, com o meu voto por item |
| `GET /releases/:version` | logado | uma publicada (a pílula de atualização pede a versão baixada) |
| `PUT /releases/:version/reactions/:itemId` `{value: 1 \| -1 \| 0}` | logado | meu voto (0 desfaz); 60/min |
| `GET/POST /admin/releases`, `PUT/DELETE /admin/releases/:version`, `POST /admin/releases/:version/(publish\|unpublish)` | staff `admin` | estúdio; tudo no `staff_audit_log` |

Contrato e validação: `packages/shared/src/releases.ts` (`ReleaseContent`). Edição concorrente: o `PUT` leva a
`revision` lida; se alguém salvou no meio, 409 e nada se perde em silêncio.

## Testes

- `packages/shared/src/releases.test.ts`, `apps/server/test/releases.test.ts` (também em PostgreSQL real:
  `npm run test:pg -w apps/server -- test/releases.test.ts`), `apps/desktop/src/renderer/src/features/whatsnew/logic.test.ts`.
- Ponta a ponta no app real (stack isolada, não toca no dev):
  `QA_WORK=<pasta> QA_API_PORT=4360 QA_LK_PORT=7960 node apps/desktop/scripts/whatsnew-e2e.mjs` — capturas em
  `docs/screenshots/whatsnew/`.

## Deploy

A migração `0017_release_notes` cria as tabelas e a `0018_release_history` grava o histórico 0.1.3–0.1.14 (publicado,
reescrito a partir dos GitHub Releases, com capturas reais do app) e a nota da 0.1.15 como **rascunho**. Suba a API
antes de distribuir o desktop 0.1.15; um app novo contra uma API antiga só não mostra novidades (o 404 é silencioso).
