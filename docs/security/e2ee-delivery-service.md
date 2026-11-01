# E2EE — Delivery Service: o que o servidor garante e o que ele ainda pode fazer (2026-11-01)

Escopo: `apps/server/src/e2ee.ts` (DS), `packages/shared/src/e2ee.ts` (contrato e fluxo),
`apps/desktop/src/main/mls/**` (cliente), `native/mls` (OpenMLS 0.9.2). Desenho e modelo de ameaças:
`docs/decisions/0004-e2ee.md` §1 e §3. Testes: `apps/server/test/e2ee.test.ts` (servidor real + WASM real + o
controlador do desktop), `native/mls/src/tests.rs`.

## O que o servidor guarda

- **`device_keys`**: a chave pública Ed25519 de cada dispositivo, ligada ao usuário e à sessão que a registrou. A
  sessão some (logout, troca de senha, revogação, suspensão) → o dispositivo e seus key packages somem junto.
- **`key_packages`**: key packages (dados públicos), uso único. Os segredos HPKE deles ficam só na memória do worker
  do cliente; por isso cada registro esvazia o estoque do dispositivo.
- **Em memória, por chamada**: o estado **público** do grupo MLS (`PublicCall` = `PublicGroup` da OpenMLS: árvore
  com chaves públicas, contexto do grupo, transcript), as mudanças de membro ainda não confirmadas e quem faz o
  commit. Nenhum segredo de época, nenhuma chave privada, nenhuma chave de mídia.
- **Chave do DS** (`E2EE_DS_KEY`, obrigatória em produção): só assina as proposals Add/Remove. Não decifra nada.
- **Logs**: nunca bytes MLS nem chaves. Só `channelId`, época e o motivo de recusa.

## O que o DS garante (com clientes honestos)

1. **Não lê a mídia.** Não é membro: o segredo de cada época sai de segredos de caminho cifrados (HPKE) para os
   membros e do segredo de inicialização da época anterior, que o DS nunca tem.
2. **Ordem.** Um commit por época: o primeiro **válido** vence, vai a todos os membros daquela época (`E2EE_COMMIT`);
   qualquer outro para a mesma época recebe `commit_rejected`.
3. **Commit conferido antes de ser repassado**, contra a árvore pública: assinatura do remetente (e o remetente é a
   folha do socket que mandou), só proposals do próprio DS e por referência, nenhum commit vazio, identidade e chave do
   committer inalteradas no UpdatePath, Welcome cifrado para **exatamente** os key packages adicionados, e nenhum
   usuário com duas folhas. Nada muda no estado se a conferência falha.
4. **Welcome só para o dispositivo adicionado** (os sockets ligados àquele `deviceId` pelo `e2ee_join`).
5. **Key package só do próprio dispositivo**: identidade `userId:deviceId` do usuário autenticado, dispositivo
   registrado por esta sessão, chave de assinatura igual à registrada, suíte 1, assinatura e vida útil válidas.
   Consumo atômico (`DELETE … FOR UPDATE SKIP LOCKED`): duas entradas nunca usam o mesmo.
6. **Remoção imediata**: sair da voz (webhook), expulsão, ban, mover, desconectar, perda de `CONNECT`, canal apagado,
   dispositivo apagado ou registrado de novo → Remove proposto na hora, sem esperar o LiveKit. Quem foi removido não
   acompanha a época seguinte (provado no teste: chave nova diferente, `export_secret` falha no removido).
7. **Uma folha por usuário por chamada**: entrar de novo é Remove da folha antiga + Add no mesmo commit.
8. **Limites**: frames `e2ee_*` com cota própria (60/min por socket) e até 72 KiB; demais ops continuam em 16 KiB e
   120/min. REST 10/min por rota; até 10 dispositivos por conta e 100 key packages por dispositivo, 50 por envio.

## O que um servidor malicioso (ou comprometido) ainda pode fazer

O DS é também quem diz qual chave pública pertence a qual usuário. Sem verificação, confia-se nele para a identidade
(como no DAVE).

| Ataque | Como | O que o cliente faz contra |
|---|---|---|
| **Troca de chave** (MITM) | Registra uma chave sua como dispositivo da vítima (a sessão é emitida pelo próprio servidor) e propõe o Add desse impostor `vítima:dispositivo` | Código par a par (45 dígitos) muda; aviso de "chave mudou" para quem foi verificado (fase 4) |
| **Membro fantasma** | Propõe o Add de um dispositivo seu numa chamada | O fantasma aparece na lista do **MLS** (`E2eeEpochInfo.members`), que o cliente compara com a sala do LiveKit (faixa vermelha, fase 1b/4). O código da chamada é o mesmo para o fantasma: só a lista pega isso |
| **Mundos divididos** | Entrega commits diferentes a grupos de membros | Códigos da chamada diferentes |
| **Negar serviço** | Não repassa, reseta grupos (`not_member`), remove membros, esgota key packages pelo `GET …/key-packages` (10/min, só quem tem vínculo com o dono), derruba sockets | Nenhuma defesa criptográfica; aparece como falha (`state: 'failed'`) |
| **Downgrade** | Responde `unavailable` ou não anuncia E2EE | Hoje a UI diz "sem criptografia"; na fase 5 o cliente recusa |
| **Metadados** | Vê quem entra e sai, quando, o tamanho dos handshakes e quem faz commit | — (fora do escopo, 0004 §1.2) |

O DS **não** consegue: ler mídia ou derivar chaves de época; forjar commits de membros (não tem as chaves de
assinatura deles); ler um Welcome (cifrado para o key package do destinatário); manter um removido decifrando.

Quem rouba **só** a `E2EE_DS_KEY` também precisa controlar a entrega (o gateway) para propor um Add; sem isso a chave
não serve. Trocar a chave invalida os grupos em andamento (eles são recriados, como num restart).

## Limites conhecidos

- **MACs**: as tags de confirmação e de membro de um commit são MACs que só membros conferem. Um membro pode mandar
  um commit com tag ruim que passa no DS; os outros recusam e fazem `e2ee_resync`. É um DoS de quem já está dentro.
- **Committer que não faz commit**: 1 s e passa para o próximo; 3 vezes na mesma época e o grupo é resetado (todos
  entram de novo).
- **Estado em memória, uma instância** (`shortcut:` em `src/e2ee.ts`): restart do servidor = grupos recriados quando
  os clientes reenviam `e2ee_join` no READY.
- **Imagem Docker**: `infra/server/Dockerfile` ainda não copia `native/mls/pkg`; sem ela o servidor sobe com E2EE
  desligado (REST 503, `e2ee_*` → `unavailable`). Falta uma linha `COPY native/mls/pkg native/mls/pkg` no estágio de
  runtime (fora do escopo desta fase).
- **Bug da OpenMLS**: um membro removido mantém as chaves HPKE da última época depois do `delete`. O wrapper apaga
  (`native/mls/src/lib.rs`, `drop_group`); texto para o upstream em `docs/security/upstream-openmls-issue.md`.
