# Feedback — "Conta pro Eco"

O lugar onde quem usa o Alga Meet conta um bug, um travamento, uma ideia ou um elogio, sem sair do app. O que chega
fica guardado no servidor para o painel administrativo, que ainda não existe: **hoje não há tela para a equipe ler**
(veja "Ler os envios enquanto não há painel").

Desenho: `docs/superpowers/specs/2026-11-09-feedback-design.md`. Visual e movimento: `docs/design/design-system.md` ›
Feedback.

## O que cada pessoa vê

- **Onde abre.** Sem ícone fixo: Ctrl K › "Enviar feedback", o menu do usuário (canto inferior esquerdo, acima de Sair)
  e Configurações › Avançado › Feedback.
- **O cartão.** Pequeno, sobre o painel do usuário, e **não é modal**: o app continua usável por trás. Tipo (Bug,
  Travou, Ideia, Elogio; começa em Ideia), um campo de texto (até 2000 caracteres, Ctrl Enter envia) e, se quiser, um
  print: colar, arrastar para o cartão ou "Tirar print do app" (o cartão some por um instante e o app fotografa a
  própria janela).
- **Rascunho.** Fechar (Esc ou ×) não perde nada: tipo e texto ficam neste PC, por conta, e voltam ao reabrir, mesmo
  depois de reiniciar. O print não é guardado no rascunho.
- **Vai junto.** Uma linha sempre à vista e "ver", que mostra o conteúdo exato:
  - sempre: versão do app, sistema, e onde a pessoa estava: início, conversa direta ou espaço; em chamada;
    transmitindo; no Cinema. **Nunca** nomes ou ids de espaço, canal ou pessoa;
  - só em Bug e Travou: o fim do `main.log` (até 200 linhas e 48 KB), ligado por padrão, com uma chave para tirar.
- **Enviado.** "Recebido. Valeu, {nome}!" e o envio entra em **Seus envios**, com a etiqueta "Recebido" (fixa até o
  painel existir). Fecha sozinho em 4 s.
- **Falhou.** A frase aparece no cartão, o botão vira "Tentar de novo" e texto e print continuam lá. Limite: 10 envios
  por hora por pessoa.
- **Depois de um travamento.** Se a sessão anterior acabou com a interface caindo ou com a janela sem responder, na
  abertura seguinte o app pergunta uma vez, num momento calmo (fora de chamada, sem jogo, sem outro diálogo, janela
  em foco, e nunca junto das boas-vindas das Novidades): "Travei da última vez. Quer me contar o que aconteceu?".
  "Contar" abre o cartão em Travou com o log **da sessão que caiu**. Marcadores com mais de 7 dias são ignorados.

## API

| Rota | Quem | O quê |
|---|---|---|
| `POST /feedback` (multipart) | logado, 10/hora | campos `kind`, `text`, `context` (JSON), `log` (opcional) e arquivo `screenshot` (opcional, PNG/JPEG/WebP até 8 MB). 201 com o envio |
| `GET /feedback/@me` | logado | os meus, mais novo primeiro, até 50: `id`, `kind`, `text`, `createdAt`, `hasScreenshot` |

- Contrato e limites: `packages/shared/src/feedback.ts` (`FeedbackFields`, `FeedbackContext`, `FeedbackItem`).
- A versão do app e o sistema vêm do cabeçalho `X-Alga-Client` (coluna `client`).
- O servidor descarta o `log` em Ideia e Elogio, recusa contexto com qualquer campo a mais e regrava o print como WebP
  (lado máximo 2560 px, sem metadados) em `feedback/<userId>/<id>.webp`.
- Tabela `feedback` (migração `0019`). Apagar a conta apaga as linhas, e um gatilho põe o print na fila de remoção do
  armazenamento. O feedback entra na exportação de dados (o print é indicado, não incluído).
- `POST /feedback/uninstall` (o "Por que está saindo?", anônimo) é outra coisa e não mudou.

## Ler os envios enquanto não há painel

Direto no banco (o painel vai ganhar a rota e o download do print):

```sql
select f.created_at, u.username, f.kind, f.text, f.client, f.context, f.storage_key is not null as print
from feedback f join users u on u.id = f.user_id
order by f.created_at desc limit 50;
```

O `log` de um envio: `select log from feedback where id = '…';`. O print está no armazenamento de arquivos, na chave
`storage_key`.

## No app (desktop)

- `apps/desktop/src/renderer/src/features/feedback/`: `logic.ts` (regras puras), `store.ts` (estado, envio, oferta),
  `Card.tsx`, `CrashOffer.tsx`, `Host.tsx` (montado no `Shell`), `anchor.ts`, `strings.ts`.
- Pontes em `window.alga.app` (`apps/desktop/src/main/feedback.ts`): `recentLog(previous)`, `captureWindow()`,
  `takeCrash()`. O marcador de travamento é `crash-marker.json` na pasta de dados do app.

## Testes

- `packages/shared/src/feedback.test.ts`, `apps/server/test/feedback.test.ts` (também em PostgreSQL real:
  `npm run test:pg -w apps/server -- test/feedback.test.ts`),
  `apps/desktop/src/main/feedback-logic.test.ts`,
  `apps/desktop/src/renderer/src/features/feedback/{logic,store}.test.ts`.
- Ponta a ponta no app real (stack isolada, não toca no dev):
  `QA_WORK=<pasta> QA_API_PORT=4370 QA_LK_PORT=7970 node apps/desktop/scripts/feedback-e2e.mjs` — capturas em
  `docs/screenshots/feedback/`.

## Deploy

Suba a API (migração `0019_feedback`) antes de distribuir o desktop com o cartão. Um app novo contra uma API antiga
mostra a falha no próprio cartão e guarda o rascunho.
