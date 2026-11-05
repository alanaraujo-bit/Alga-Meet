# Atividade em tempo real, status personalizado e perfil completo

Branch `feat/presence` (worktree `D:\PROJETOS\alga-presence`). Pedido do dono em 2026-11-05 (madrugada, autonomia total):
"ver em tempo real o que o amigo está fazendo, com ícone e informação do programa, de forma sexy", e aperfeiçoar o
fluxo de perfil tendo o Discord como referência (estudo em `docs/research/discord-profile-study.md`).

## Intenção
Dar aos amigos um motivo para olhar o perfil e chamar o outro ("bora?"): o que a pessoa está fazendo agora, há quanto
tempo, e uma porta de entrada (a sala de voz). Melhor que o Discord em três pontos: **privacidade transparente** (a
pessoa vê exatamente o que sai e de quais apps), **arte de verdade** (capa da Steam, ícone com a cor do próprio app) e
**zero configuração** (detecta sozinho; nada de SDK por jogo).

## O que foi feito
| Parte | Onde | Notas |
|---|---|---|
| Contrato | `packages/shared/src/activity.ts` | `Activity`, `CustomStatus`, `ProfileExtras`; `Presence.activity` / `Presence.custom`; ops `activity` e `custom_status` |
| Servidor | `gateway/hub.ts`, `gateway/socket.ts`, `routes/profile.ts` | tudo em memória, **sem migração**; `GET /users/:id/profile` |
| Detector | `apps/desktop/native/activity/AlgaActivity.cs`, `src/main/activity*.ts` | helper C# de ~14 MB compilado pelo `csc.exe` do Windows (sem dependência nova) |
| UI | `features/activity/*`, `features/profile/*` | cartão no perfil, linhas nas listas, ícone na sala de voz, "Ativo agora", Configurações → Atividade, status, perfil completo |
| Verificação | `apps/desktop/scripts/activity-shots.mjs` | E2E isolado (API própria :4360, app fora da tela, detector real): 16/16 |

## Decisões (minhas, para o dono revisar)
1. **Detecta só o app em primeiro plano, nunca título de janela/arquivo/site.** Jogos ficam enquanto o processo vive
   (alt-tab não derruba); apps de trabalho somem após 15 min sem foco ou com o PC ocioso. Ociosidade não vale para
   jogo (controle não conta como entrada no Windows), vídeo e música.
2. **Ligado por padrão**, mas só para o que é reconhecido (≈90 jogos, ferramentas de código/criação/mídia, pastas de
   lojas, tela cheia). Navegadores, mensageiros e desconhecidos começam **ocultos**; cada app tem seu interruptor.
3. **Controles onde a coisa aparece**: no próprio cartão há "Pausar 1 h" e "Ocultar"; em Configurações, contagem ao vivo
   de quem vê ("Visível para N pessoas"), prévia e a lista de apps detectados.
4. **Invisível = nada sai do PC** (o cliente nem envia) e a atividade recente fica vazia para os outros.
5. **Status personalizado como presença** (igual ao Discord: é um tipo de atividade). O cliente guarda e reenvia a cada
   conexão; o servidor só repassa. Por isso não precisou de migração (a do soundboard é a 0013).
6. **Atividade recente em memória** do servidor (14 dias, 6 itens, ≥ 1 min). Some num deploy — atalho anotado no código;
   vira tabela se o recurso provar valor.
7. Steam: capa (`library_600x900`) no ícone e arte (`header`) nítida à direita do cartão, do CDN público da Valve
   (o CSP já permite https). Apps da Microsoft Store: logo lido do `AppxManifest`.

## Como verificar
- `npm test -w apps/server` (234), `npm test -w apps/desktop` (297), `npm run typecheck -w apps/desktop`.
- `node apps/desktop/scripts/activity-shots.mjs` (abre uma Calculadora por ~20 s; precisa de alguém usando o PC ou
  roda com `ALGA_E2E=1`, que já ignora ociosidade).

## Integração (atenção)
- O checkout principal tem trabalho **não commitado** do pacote C em `features/shell/{MemberList,people,Shell}.tsx` e
  `features/billing/**`. Esta branch toca `MemberList.tsx` e `UserPanel.tsx` (linhas próprias) e **não** toca
  `features/billing/**`. Commite/conclua o pacote C antes de mesclar; o conflito esperado é só de linhas vizinhas.
- O soundboard (`feat/soundboard`) também edita `models.ts`, `gateway.ts`, `app.ts` e `ui/icons.tsx` — tudo aditivo.
- Servidor novo precisa ir para o staging junto com o app (clientes antigos ignoram os campos novos).

## Revisão independente (feita) e limites conhecidos
Corrigido após revisão: bloqueio vale para presença/atividade/status/perfil mesmo em espaço compartilhado; tela cheia
desconhecida é palpite opt-in; ícone exige cabeçalho PNG ≤ 256×256; `null` de outro dispositivo não apaga a atividade;
validação no cliente antes de enviar; memória do "recente" podada; ícone só de `.exe` local.
Ficou (baixo risco, anotado): com dois PCs, o status salvo num deles pode sobrescrever o mais novo do outro ao reconectar;
PID reaproveitado pode manter um jogo "vivo" por alguns segundos; o helper lê metadados do exe em foco mesmo em
compartilhamento de rede lento; a lista local de apps vistos (inclusive ocultos) fica no `settings.json` do PC.

## Próximos passos sugeridos (do estudo)
Banner por imagem grátis; widgets de perfil preenchidos pelo uso real ("Mais jogados"); privacidade de atividade por
espaço; estilo do nome de exibição como item da loja; "Entrar na partida" quando o jogo informar; persistir a
atividade recente.
