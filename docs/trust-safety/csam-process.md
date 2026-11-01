> **RASCUNHO — requer revisão de advogado antes de virar procedimento oficial.** Data: 2026-11-01.
> Fatos normativos conferidos nesta data nas fontes da seção 9. Onde a fonte não foi lida na íntegra, está dito.

# Material de abuso sexual infantil e conteúdo ilegal grave: procedimento

Este documento vale para:

- conteúdo que sexualiza qualquer pessoa com menos de 18 anos, inclusive desenhos, montagens e imagens geradas por IA
  (Diretrizes, "O que não é permitido");
- sequestro ou cárcere de criança ou adolescente;
- aliciamento de criança ou adolescente, inclusive para práticas com risco de dano físico grave ou morte.

São os três casos do art. 39 do Decreto 12.880/2026, que regulamenta o art. 27 da Lei 15.211/2025 (ECA Digital). Para
outros conteúdos ilegais graves (imagem íntima sem consentimento, ameaça real à vida), use o mesmo fluxo técnico
(quarentena e retenção legal). A comunicação à autoridade, nesses casos, é voluntária (art. 39, §3º) e passa pelo
advogado.

## 1. Resumo em 6 passos

| # | O quê | Prazo | Como (API, com papel de equipe) |
|---|---|---|---|
| 1 | **Tirar de circulação** | Imediato | Denúncia `csam` já põe os anexos em quarentena sozinha. Senão: `POST /admin/attachments/:id/quarantine` |
| 2 | **Preservar** | Imediato (automático) | Bytes vão para `evidence/<id>` com SHA-256. A conta do autor fica em retenção legal |
| 3 | **Remover o resto** | Mesmo dia | `PATCH /admin/reports/:id` `{status:"resolved", action:"remove_content"}`. Depois banir: `{action:"ban"}` em outra denúncia ou `POST /admin/users/:id/actions` |
| 4 | **Comunicar à Polícia Federal** | 12 h / 72 h / 7 dias (seção 4) | Sistema Nidus (CNCA). Anotar o protocolo: `PATCH /admin/quarantine/:id {authorityProtocol}` |
| 5 | **Apagar o material** depois do recebimento confirmado | Assim que a PF confirmar | `PATCH /admin/quarantine/:id {receiptConfirmed:true}`. O registro (hash, ids, protocolo) fica |
| 6 | **Liberar a conta** da retenção | Só após o prazo do ato do MJSP ou orientação do advogado | `PATCH /admin/users/:id {legalHold:false}` (a exclusão pendente, se houver, segue) |

## 2. O que o sistema faz sozinho

Quando alguém denuncia uma mensagem com o motivo `csam`, o servidor (`src/routes/reports.ts`, `src/trust-safety.ts`):

1. Grava a denúncia com prioridade **100**, a mais alta: ela fica no topo de `GET /admin/reports`. Também grava um
   retrato da mensagem: texto, autor e metadados dos anexos.
2. Põe **cada anexo** da mensagem em quarentena, na mesma hora:
   - a linha do anexo é apagada, então `GET /files/:id` responde 404 para todo mundo, inclusive quem já tinha o link;
   - os clientes recebem `MESSAGE_UPDATE` já sem o arquivo;
   - o objeto original sai da fila de exclusão e é copiado para `evidence/<attachmentId>`;
   - o SHA-256 da cópia é gravado em `quarantined_files.sha256`;
   - só depois disso o original é apagado. Se a cópia falhar, o original fica retido e o job tenta de novo a cada minuto.
3. Põe a **conta do autor em retenção legal** (`users.legal_hold_at`). Com isso:
   - a conta não é excluída, nem se o autor pedir;
   - os registros de acesso dela não são expurgados aos 6 meses;
   - mensagens e metadados continuam no banco (art. 39, §1º: preservar "os demais conteúdos da conta").
4. Registra um `warn` no log do servidor só com ids, sem conteúdo.

O autor apagar a mensagem ou a conta **não destrói a prova**: a quarentena não depende da mensagem, e a retenção legal
bloqueia a exclusão.

Denúncia `csam` de um **perfil** ou de um **espaço** não tem anexo para isolar. Nesses casos ela só entra no topo da
fila e põe em retenção a conta denunciada (ou a do dono do espaço). A equipe isola os arquivos à mão (passo 1).

## 3. Quem faz o quê

- **Recebe e decide:** pessoas com `staff_role` (`moderator` ou `admin`). O papel é dado só pelo script
  `apps/server/scripts/grant-staff.ts`. Toda chamada a `/admin/*` vai para `staff_audit_log`: quem, rota, parâmetros
  e resultado.
- **Comunica à PF:** o responsável credenciado no Nidus (seção 4). `[PREENCHER: nome e substituto]`.
- **Acessa a prova:** **nenhuma rota da API serve `evidence/`.** Só quem tem as credenciais do bucket consegue
  baixar o arquivo, e só para entregar à autoridade. `[PREENCHER: quem tem as credenciais]`.
  - Recomendado: um bucket separado, ou uma política de acesso por prefixo, para `evidence/`. Hoje fica no mesmo
    bucket dos anexos.
  - Não está implementado: abrir o arquivo de prova pelo painel. A decisão é tomada pelo retrato da denúncia, e o
    arquivo só é aberto quando for indispensável (seção 6).

## 4. Comunicação à autoridade

**Destino:** Polícia Federal, no **Centro Nacional de Proteção à Criança e ao Adolescente (CNCA)**. Esse é o nome
operacional do "Centro Nacional de Triagem de Notificações" (Decreto 12.880/2026, arts. 36 e 37; Portaria MJSP nº
1.312/2026). O envio é pelo **Sistema Nidus**, mantido pela PF.

**Cadastro do Alga Meet no Nidus (obrigatório, bloqueia o lançamento):**

- O cadastro dos provedores e o credenciamento de quem vai operar o sistema seguem a **Portaria DG/PF nº 19.107/2026**.
- O prazo é de **60 dias** contados da publicação dessa portaria. As fontes dão datas diferentes para ela (16 ou 20
  de outubro de 2026), o que põe o fim do prazo **em meados de dezembro de 2026**. `[CONFERIR a data no DOU]`
- A PF publicou um guia técnico de cadastro (v1.0, 21/10/2026) e um FAQ (fontes 5 e 6). Eles não foram lidos na
  íntegra nesta sessão.

**Prazos de comunicação** (Portaria MJSP 1.312/2026, contados de quando a detecção é confirmada):

| Situação | Prazo |
|---|---|
| Risco crível, iminente ou em curso | até **12 horas** |
| Material novo ou não identificado, ou produzido com ferramenta de captura do próprio provedor | até **72 horas** |
| Demais casos | até **7 dias** |

A fase de envio dos relatórios começa só depois de um ato próprio da PF, com 120 dias de adaptação. **Até lá**, ou se o
Nidus estiver fora do ar:

- **Risco imediato à vida ou à integridade:** ligar para **190** (Polícia Militar).
- **Comunicação formal:** fazer a notícia de crime na **Polícia Federal**, pelo canal de comunicação de crimes da PF ou
  na delegacia de crimes cibernéticos. `[CONFERIR o canal com o advogado antes do lançamento]`
- **SaferNet Brasil, Central Nacional de Denúncias:** opcional, em paralelo. É conveniada com o MPF e serve para a
  denúncia de qualquer pessoa. A central aceita denúncia anônima, mas **nós sempre nos identificamos**.
- **Disque 100:** quando houver violência em curso contra uma criança identificável.

**O que o relatório pode levar** (Portaria 1.312/2026): tipo e data do incidente, identificadores dos usuários, URLs,
IPs, a mídia relacionada e o hash dos arquivos. No Alga Meet, isso vem de:

- `quarantined_files` (sha256, ids, nome e tipo do arquivo);
- `reports.snapshot`;
- `GET /admin/access-logs?userId=` (rota só de admin, auditada).

**Provedores com centrais no exterior:** quem é obrigado por lei a notificar centrais de outros países (como o NCMEC,
nos EUA) fica dispensado de repetir a notificação ao CNCA (art. 37, §§2º e 3º). **Não é o nosso caso:** o serviço é
só no Brasil, então a comunicação vai ao CNCA.

## 5. Guarda e exclusão

| O quê | Até quando | Base |
|---|---|---|
| O arquivo em `evidence/` | **Até a PF confirmar o recebimento.** Depois é apagado: `receiptConfirmed` exige o protocolo antes | Decreto 12.880/2026, art. 39, §2º |
| O registro da quarentena: hash, ids, protocolo, datas | Sem expurgo automático | Prova de cumprimento (art. 40) |
| A conta do autor, as mensagens e os metadados | Enquanto durar a retenção legal, liberada pela equipe depois do prazo do ato do MJSP | Art. 39, §§1º e 2º. O prazo ainda não foi fixado: `[CONFERIR]` |
| Os registros de acesso da conta | Enquanto durar a retenção. Sem ela, 6 meses | Marco Civil, art. 15 e §2º |
| A denúncia `csam` | Sem expurgo automático (as outras somem 6 meses depois de decididas) | Segue o caso na autoridade |

A Portaria 1.312/2026 pede que a preservação mantenha a **cadeia de custódia**. No Alga Meet, ela se apoia em:

- o SHA-256 gravado na hora da cópia;
- o registro de quem pôs em quarentena (`staff_id` vazio quando foi automático) e quando;
- o `staff_audit_log`.

## 6. O que não fazer

- **Não baixar, copiar, encaminhar nem tirar print** do material. Isso vale também dentro da equipe e também "para
  mostrar ao advogado". Compartilhar material de abuso infantil é crime (ECA, arts. 241-A e 241-B), mesmo com boa
  intenção. Para falar do caso, passe só os ids e o hash.
- **Não guardar nada** no computador, no celular, no e-mail ou no chat. A única cópia é a de `evidence/`.
- **Não apagar antes de preservar.** Use a quarentena, nunca a exclusão da mensagem como primeiro passo.
- **Não avisar o suspeito nem "investigar por conta própria".** Não fale com ele e não procure a vítima. O aviso ao
  autor previsto nos Termos (8.4) **não é enviado** quando pode atrapalhar a investigação: use `ban` sem esperar
  recurso e fale com o advogado.
- **Não abrir o arquivo sem necessidade.** A denúncia traz o retrato com o nome, o tipo e o autor. Abra a mídia só
  quando a decisão realmente depender dela, e nunca sozinho.
- **Não usar o material para nada**: nem treino, nem teste, nem exemplo.
- **Não liberar a retenção legal** sem confirmar com o advogado.

## 7. Cuidado com a equipe

Ver esse tipo de material faz mal. As regras mínimas:

- **Ninguém é obrigado** a fazer essa revisão. Quem não quer pode recusar, sem nenhuma consequência.
- **Revisão em dupla** sempre que for preciso abrir a mídia. No máximo `[PREENCHER: 2]` casos desse tipo por pessoa por
  dia, com pausa depois de cada um.
- Quando houver ferramenta de visualização (ainda não existe no painel), ela deve abrir a mídia **em tons de cinza, com
  desfoque e sem som**, revelando só o necessário.
- **Apoio psicológico** pago pela empresa: `[PREENCHER: serviço/contato]`. Conversa de acompanhamento depois de
  cada caso.
- **Não levar o caso para casa:** sem acesso fora do horário e sem notificação no celular pessoal.

## 8. Lacunas técnicas conhecidas

- **Sem detecção por hash** de material já conhecido (PhotoDNA, base da SaferNet ou do NCMEC). Hoje tudo depende de
  denúncia (F13).
- **Sem envio automático ao Nidus.** O art. 42 do decreto prevê sistemas automatizados, e a integração depende do ato
  técnico da PF ainda não publicado.
- **Sem desfazer a quarentena** quando a denúncia for falsa. A restauração do anexo é manual, por SQL e cópia no
  bucket. O controle de denúncias abusivas fica para depois (F11).
- **Sem visualizador seguro** no painel (seção 7).
- **Vídeo e voz ao vivo não são gravados.** Em chamada não há o que preservar além dos registros de acesso e de quem
  estava no canal.

## 9. Fontes (acesso em 2026-11-01)

1. Decreto 12.880/2026, arts. 36, 37, 39, 40 e 42. Texto do Planalto:
   https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2026/decreto/D12880.htm
2. Agência Gov, 09/2026: "MJSP regulamenta notificação de crimes contra crianças em plataformas digitais". É a fonte
   da Portaria MJSP 1.312/2026, do Nidus, do CNCA e dos prazos de 12 h, 72 h e 7 dias. **O texto da portaria no DOU não
   foi lido.**
   https://agenciagov.ebc.com.br/noticias/202609/mjsp-regulamenta-notificacao-de-crimes-contra-criancas-em-plataformas-digitais
3. Cescon Barrieu: "ECA Digital: Polícia Federal abre cadastro no Sistema NIDUS". É a fonte da Portaria DG/PF 19.107/2026
   e do prazo de 60 dias. **A portaria não foi lida.**
   https://cesconbarrieu.com.br/eca-digital-policia-federal-abre-cadastro-no-sistema-nidus/
4. Agência Gov, 03/2026: "Nova coordenação da PF amplia proteção de crianças e adolescentes no âmbito do ECA Digital".
   https://agenciagov.ebc.com.br/noticias/202603/nova-coordenacao-da-pf-amplia-protecao-de-criancas-e-adolescentes-no-ambito-do-eca-digital
5. CNCA, guia técnico de cadastro no Nidus, v1.0 (não lido):
   https://www.gov.br/cnca/pt-br/arquivos/nidus_guia_tecnico_cadastro_credenciamento_provedores_vfinal.pdf/@@display-file/file
6. CNCA, FAQ sobre as obrigações de cadastro (não lido):
   https://www.gov.br/cnca/pt-br/arquivos/nidus_faq_obrigacoes_cadastro_v1-0_final.pdf/@@display-file/file
7. Agência Brasil, 02/2026: dados de 2025 da Central Nacional de Denúncias da SaferNet, conveniada com o MPF.
   https://agenciabrasil.ebc.com.br/geral/noticia/2026-02/denuncias-de-crimes-ciberneticos-crescem-28-em-2025-mostra-safernet

**Não reconsultados nesta sessão:** o endereço de denúncia da SaferNet (https://new.safernet.org.br/denuncie), o Disque
100 e os arts. 241-A a 241-E do ECA (Lei 8.069/1990).
