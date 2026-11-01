> **RASCUNHO — requer revisão de advogado antes de publicação**
>
> Notas para o advogado e para o time. Data: 2026-11-01. Isto não é parecer jurídico. É a lista do que o rascunho
> assume, do que o produto ainda não faz e de onde cada fato veio.

# Revisão: Termos, Privacidade e Diretrizes

Arquivos revisados:

- `docs/legal/termos-de-uso.md`
- `docs/legal/politica-de-privacidade.md`
- `docs/legal/diretrizes-da-comunidade.md`

Fatos do produto foram tirados de:

- `docs/ARCHITECTURE.md`, seção Segurança: sem E2EE; mídia DTLS-SRTP até o SFU.
- `apps/server/README.md` e `apps/server/src/db/schema.ts`: dados guardados, retenção e limites.
- `docs/business/monetization.md`: planos, cosméticos, checklist de arrependimento.
- `docs/infra/deploy.md` e `docs/infra/cost-model.md`:
  - Railway US East: API, Postgres, bucket e logs;
  - Vultr São Paulo: SFU;
  - Resend: e-mail;
  - GitHub Releases: updater.
- `docs/security/server-review-2026-11-01.md`.
- O código do desktop: `apps/desktop/src/main/{secure-store,log,hotkeys,updater}.ts` e
  `apps/desktop/src/renderer/src/media/prefs.ts`.

Nada foi inventado. Onde o fato não estava no repositório, o texto traz `[PREENCHER]`.

## 0. Status (atualizado em 2026-11-01, backend)

O servidor agora cobre as lacunas abaixo. As decisões e o funcionamento estão em `docs/trust-safety/README.md`. O
procedimento para abuso infantil está em `docs/trust-safety/csam-process.md`.

Duas coisas ainda faltam em todas elas:

- **as telas no desktop**;
- **a revisão do texto** da Política e dos Termos. Os `[LACUNA]` correspondentes só podem sair depois que o desktop
  entregar a tela.

| # | Status | O que existe / o que falta |
|---|---|---|
| L1 | **Backend feito** | `birthDate` obrigatório em produção, recusa abaixo de 16 sem gravar nada, `Me.ageBracket`. Conta antiga declara uma vez. Abaixo de 16: suspensão, recurso e exclusão em 30 dias. A data serve só para a faixa (art. 13). **Falta:** desktop. Também falta decidir D2: a aferição continua sendo autodeclaração |
| L2 | **Backend feito** | `POST /reports` com retrato do alvo e fila da equipe. Medidas na conta: aviso, suspensão até uma data e banimento, aplicadas no login, nas sessões, no gateway e na voz. E-mail com a categoria e recurso. A identidade de quem denuncia não é revelada. **Falta:** desktop (botão "Denunciar", tela de conta suspensa e de recurso) e um painel da equipe (hoje só a API) |
| L3 | **Backend e procedimento feitos** | Denúncia `csam` põe os anexos em quarentena na hora, com prova e SHA-256 guardados à parte e a conta em retenção legal. Procedimento escrito, com o destino (PF/CNCA pelo Nidus) e os prazos da Portaria MJSP 1.312/2026. **Falta:** cadastro no Nidus (prazo por volta de dezembro de 2026), a pessoa responsável e o apoio psicológico |
| L4 | **Backend feito** | `DELETE /users/@me` com senha e 7 dias de carência; entrar de novo cancela. Espaços vão ao membro de cargo mais alto, ou são excluídos. Os pagamentos ficam sem a identidade. As FKs `restrict` são tratadas, não removidas. D13 decidido: a pessoa escolhe, e o padrão é **anonimizar** como "Usuário removido". Anexos e avatar sempre apagados. **Falta:** desktop, e decidir o pedido de exclusão de conta suspensa ou banida |
| L5 | **Backend feito** | `POST /users/@me/export`: zip com JSON e links assinados dos anexos, link de 7 dias enviado só por e-mail, 1 pedido por dia. **Falta:** desktop |
| L6 | **Backend feito** | Tabela `access_logs`: cada login e o primeiro uso do dia por IP e app. Ficam 6 meses mesmo depois da exclusão da conta, com acesso só de admin e auditado. **Falta:** D23 (porta de origem) |
| L7 | **Backend feito** | `termsVersion` no cadastro (obrigatório em produção), histórico em `consent_records`, `Me.needsTermsAcceptance` e `POST /users/@me/accept-terms`. **Falta:** desktop (caixa desmarcada e links de `GET /legal`) |
| L10 | **Backend feito** | De 16 a 17 anos: DM só com amigos, nos dois sentidos, sem revelar a idade. Sem compras (P3). Não foi criado selo de espaço 18+, porque D7 proíbe conteúdo adulto em todo o serviço. **Falta:** desktop |
| P3 | **Backend feito** | O checkout recusa quem tem 16 ou 17 anos. Também recusa idade desconhecida quando a data de nascimento é exigida. Fica pendente o modelo de assistência do responsável (D3) |
| F3 | **Feito** | `staff_audit_log` registra toda chamada `/admin/*` antes de executar, inclusive a leitura da fila. A Política pode perder o `[LACUNA]` da seção 5 |
| F6 | Parcial | Sessões, tokens e contas não verificadas continuam sem limpeza. O job novo faz a retenção de acesso, de casos e de exportações |

Afirmações que mudam:

- "Sessões sem IP" continua verdade: o IP fica em `access_logs`, não em `sessions`.
- A linha "Registros de acesso" da Política deixa de ser `[LACUNA]`.
- A linha "Denúncias e moderação" agora tem prazo implementado: 6 meses depois da decisão. Denúncias `csam` não têm
  expurgo automático.

## 1. Lacunas que bloqueiam o lançamento

Ordenadas por gravidade. "Grátis" bloqueia qualquer lançamento público. "Pago" bloqueia só a cobrança real.

| # | Bloqueia | Lacuna | Exigência | O que fazer |
|---|---|---|---|---|
| L1 | Grátis | **Sem controle de idade.** O cadastro (`RegisterBody`) não pede data de nascimento. Não há bloqueio para menores de 16 nem fluxo de suspensão com recurso | Lei 15.211/2025, art. 24 (contas de até 16 anos vinculadas a um responsável) e §4º (suspensão por indícios, com recurso). A ANPD considera a autodeclaração sozinha "pouco confiável", sobretudo com interação entre usuários. Adaptação vai de ago. a nov./2026 e a **fiscalização começa em jan./2027** | Data de nascimento no cadastro, recusa abaixo de 16, campo usado só para idade (art. 13), suspensão por indícios e tela de recurso. Método de aferição: ver D2 |
| L2 | Grátis | **Sem denúncia e sem moderação da plataforma.** O app não tem "Denunciar": `MessageItem.tsx` omite de propósito, porque não há backend. Também não existem fila para a equipe, suspensão ou banimento da *conta* (só ban por espaço), aviso ao autor nem recurso | Lei 15.211/2025, arts. 28 a 30 (mecanismo de notificação, remoção sem ordem judicial quando a vítima ou o MP avisa, aviso ao autor com fundamentação e recurso). STF, Temas 987/533 (dever de cuidado após notificação) | Denúncia de mensagem, perfil e espaço. Painel mínimo da equipe: ver o conteúdo denunciado, remover, suspender ou encerrar a conta ou o espaço, registrar a decisão. Aviso ao autor e recurso. A identidade de quem denuncia não é revelada |
| L3 | Grátis | **Sem processo para abuso sexual infantil** | Lei 15.211/2025, art. 27: remover, comunicar às autoridades nacionais e internacionais, guardar os dados pelo prazo do Marco Civil | Procedimento escrito: quem recebe, como preserva a evidência sem redistribuí-la, a quem comunica (D21) e em que prazo. Depende de L2 para remover |
| L4 | Grátis | **Sem exclusão de conta.** Não há `DELETE /users/@me`. Além disso, `subscriptions`/`orders` têm FK `restrict` de propósito e `spaces.owner_id` também é `restrict` | LGPD, art. 18, VI. Marco Civil, art. 7º, X | Endpoint e UI com confirmação. Apagar perfil, sessões, relações e membros. Excluir os espaços próprios (não há transferência de posse) ou pedir a transferência. Desvincular os registros de pagamento da identidade. Aplicar a decisão D13 às mensagens. Os anexos vão para `storage_deletions` |
| L5 | Grátis | **Sem exportação de dados** | LGPD, art. 18, II e V, e art. 19, II (declaração completa em 15 dias) | Endpoint que gere JSON com conta, perfil, relações, espaços, mensagens próprias e pagamentos, mais os links dos anexos. Até existir, ter procedimento manual documentado com prazo de 15 dias |
| L6 | Grátis | **Sem registros de acesso por 6 meses.** O IP só aparece no log de requisição (stdout para o Railway), sem vínculo com a conta e com retenção desconhecida. `sessions` não guarda IP | Marco Civil, art. 15: data, hora e IP, sob sigilo, ambiente controlado, 6 meses. Art. 5º, VIII | Tabela própria (usuário, IP, data e hora), com acesso restrito e expurgo automático depois de 6 meses. Confirmar se a **porta lógica de origem** é obtida atrás do edge do Railway (D23) |
| L7 | Grátis | **Sem registro de aceite** dos Termos e da Política | LGPD (ônus da prova, art. 8º, §2º, se houver consentimento) e prova contratual | Guardar a versão aceita e a data no cadastro, com links visíveis e caixa não marcada. Pedir novo aceite em mudanças relevantes |
| L8 | Grátis | **Contratos com fornecedores.** Railway e Resend publicam DPA com as **cláusulas-padrão da UE**, não as da ANPD. Não há nada assinado | LGPD, art. 33. Resolução CD/ANPD nº 19/2024: texto das cláusulas incorporado sem alteração. O prazo de adequação terminou em **23/08/2025** | Aceitar os DPAs e incorporar as cláusulas-padrão da ANPD (ou outra base: D6) com Railway, Resend e GitHub. Analisar a Vultr (D6). O Mercado Pago é controlador independente, sem DPA de operador |
| L9 | Grátis | **Identificação da empresa e encarregado.** Faltam razão social, CNPJ, endereço e encarregado nomeado | Decreto 7.962/2013, art. 2º. LGPD, art. 41. Res. CD/ANPD nº 18/2024, art. 8º (nome e contato publicados). A dispensa de pequeno porte (Res. 2/2022, art. 11) provavelmente não vale: tratar dados de adolescentes é critério de alto risco (arts. 3º e 4º) | Constituir ou indicar a PJ, nomear o encarregado, publicar os contatos e preencher os `[PREENCHER]` |
| L10 | Grátis (se aceitar 16–17) | **Sem padrão protetivo para adolescentes.** Hoje uma DM 1:1 com quem divide um espaço é aberta por padrão | Lei 15.211/2025, art. 7º (configuração mais protetiva por padrão) e art. 17, §4º | Para contas de 16–17 anos: DM só de amigos por padrão e status "invisível" disponível. Depende de L1. Alternativa: 18+ no lançamento (D1) |
| L11 | Grátis | **Fatos de infraestrutura em aberto** na Política: retenção de logs do Railway, backups do Postgres configurados ou não, região do Resend, cifragem em disco e razão social da Vultr | Transparência (LGPD, arts. 6º, VI, e 9º) | Conferir no painel de cada provedor e preencher. Se não houver confirmação, **não afirmar** |
| P1 | Pago | **Arrependimento só manual.** Hoje é estorno no painel do Mercado Pago, que dispara o webhook e revoga o direito | CDC, art. 49. Decreto 7.962/2013, art. 5º: mesmo canal da compra, aviso imediato à operadora e confirmação imediata do pedido | Botão "Pedir reembolso" nos 7 dias, para a 1ª cobrança do Plus e para cada cosmético. Confirmação por e-mail na hora. Estorno pela API do MP (`/v1/payments/{id}/refunds` ainda **não verificado**, ver `monetization.md` §8) |
| P2 | Pago | **Sem confirmação da compra por e-mail.** Os templates só cobrem verificação e senha. Não há link para os Termos no checkout | Decreto 7.962/2013, art. 4º: sumário do contrato antes, confirmação imediata depois | O texto curto do plano já diz "Renova sozinho até você cancelar… Reembolso integral em 7 dias". Somar preço, periodicidade e link dos Termos antes de pagar, e e-mail de recibo depois |
| P3 | Pago | **Compras por menores** | Código Civil, arts. 3º a 5º e 171 (16–17 anos: relativamente incapazes) | Na hora da compra, exigir 18+ ou um responsável. Depende da data de nascimento (L1). Ver D3 |
| P4 | Pago | **A UI promete "Fica com você para sempre"** para cosméticos (`billing/strings.ts`, `buyFine`), mas os Termos falam em licença enquanto a conta e o serviço existirem | CDC, arts. 30 e 37 (a oferta vincula; publicidade enganosa) | Alinhar o texto da UI com os Termos (D10) |
| P5 | Pago | **Canal de atendimento** para cancelamento e reclamação | Decreto 7.962/2013, art. 4º, V | Definir e publicar o e-mail. O cancelamento no app já existe (`POST /billing/subscription/cancel`) |

Recomendado antes do lançamento pago, mas não obrigatório por lei federal hoje:

- **Aviso por e-mail antes da renovação anual**, com pelo menos 7 dias. Não está implementado.
- Não há lei federal sobre cancelamento ou renovação. Há leis estaduais (RJ, dez./2025 [RELATO]) e PLs federais,
  como o PL 4983/2026.

## 2. Lacunas para depois do lançamento

| # | Lacuna | Por quê |
|---|---|---|
| F1 | **Vinculação a um responsável e ferramentas de supervisão**, para abrir o app a quem tem 13–15 anos | Lei 15.211/2025, arts. 17, 18 e 24. Sem isso, a idade mínima fica em 16 |
| F2 | Receber o sinal de idade do sistema operacional | Art. 12 e art. 14. A distribuição é direta (NSIS), sem loja, então só o sinal do Windows pode chegar |
| F3 | Registro de auditoria do acesso da equipe a conteúdo | Coerência com a seção 5 da Política (sem E2EE) |
| F4 | Trocar e-mail (não existe rota) | LGPD, art. 18, III. Até lá, pedido manual |
| F5 | Transferir a posse de um espaço | Hoje o dono só pode excluir o espaço (afeta L4) |
| F6 | Limpeza automática | Contas não verificadas nunca expiram. Sessões vencidas só somem quando são apresentadas. `email_tokens` vencidos ficam até a próxima emissão. É uma questão de minimização (LGPD, art. 6º, III) |
| F7 | Remover metadados de HEIC, TIFF, BMP e RAW, e antivírus nos anexos | Hoje o GPS dessas imagens chega a quem baixa. A Política avisa disso |
| F8 | E2EE de mídia e mensagens | Roadmap (`docs/STATE.md`). Ao lançar, revisar a seção 5 da Política |
| F9 | RIPD (art. 38) e registro das operações (art. 37) | Recomendado, por haver adolescentes. A tabela da seção 2 da Política serve de base |
| F10 | Plano de resposta a incidentes | LGPD, art. 48. Res. CD/ANPD nº 15/2024 (não reconsultada nesta sessão: conferir o prazo de comunicação) |
| F11 | Controle de denúncias abusivas | Lei 15.211/2025, arts. 32 e 33 |
| F12 | Relatório de transparência semestral | Art. 31: só acima de 1 milhão de usuários menores no país |
| F13 | Detecção de material de abuso já conhecido por *hash* | Voluntário. Avaliar com o advogado e com a SaferNet |
| F14 | Lançamento internacional | Termos por país, idade de consentimento local, GDPR e provedor em USD |
| F15 | Cadastro no consumidor.gov.br | Termos, seção 15 |
| F16 | Preferência "DMs de membros dos espaços" | Pendência do achado M5 em `server-review-2026-11-01.md`. Útil para L10 |

## 3. Decisões e premissas para o advogado confirmar

| # | O que o rascunho assume | Por quê / risco |
|---|---|---|
| D1 | **Idade mínima de 16 anos** no Brasil | 13+ exigiria, até os 16, conta vinculada a um responsável e ferramentas de supervisão (arts. 17, 18 e 24), que não existem. 18+ simplificaria L10 e P3, mas tiraria o público jogador de 16–17 anos. 16 é o menor piso que dá para cumprir sem construir F1. Em compensação, exige L1 e L10 |
| D2 | Método de aferição de idade no cadastro | Só a data de nascimento informada seria autodeclaração, que a ANPD considera pouco confiável. Os parâmetros finais da ANPD estão na 2ª fase (desde ago./2026). Decidir se, para um serviço sem conteúdo adulto e com piso de 16, basta autodeclaração + suspensão por indícios + recurso, ou se é preciso um método mais forte. Biometria só se justifica em alto risco, sem alternativa menos invasiva |
| D3 | Pessoas de 16–17 aceitam os Termos sozinhas. Compras exigem 18+ ou um responsável | Capacidade relativa (Código Civil, art. 4º, I). Confirmar a validade do aceite e o modelo de "assistência" na compra |
| D4 | O Alga Meet é **rede social** e tem **acesso provável** por adolescentes (Lei 15.211/2025, arts. 1º e 2º, III) | Discord-like: espaços com compartilhamento entre usuários. Confirmar também se as DMs são "mensageria privada" (o art. 19 do Marco Civil continua valendo para comunicações pessoais, segundo a tese do STF) e os espaços entram no regime de responsabilidade ampliada |
| D5 | Bases legais: **contrato** no serviço; **legítimo interesse** para logs técnicos, limites anti-abuso e banimentos; **obrigação legal** para Marco Civil, registros fiscais e data de nascimento; nenhum uso de consentimento | Fazer o teste de balanceamento (LIA) do legítimo interesse. Confirmar se a data de nascimento cabe em "obrigação legal" |
| D6 | Transferência internacional por **cláusulas-padrão da ANPD** com Railway, Resend e GitHub | Alternativa: LGPD, art. 33, IX, "quando necessário" para executar o contrato (art. 7º, V). Confirmar se basta ou se as cláusulas são exigíveis. Vultr: servidor no Brasil, empresa dos EUA. Há transferência se houver acesso do exterior? GitHub: o próprio app do usuário fala com os EUA |
| D7 | **Conteúdo sexual explícito proibido** em todo o serviço | Evita o art. 9º (verificação de idade a cada acesso, autodeclaração vedada). O produto não tem marcação de espaço adulto, então a regra é coerente |
| D8 | Arrependimento integral em 7 dias para a **1ª cobrança do Plus, cada cosmético e a renovação anual**. A renovação mensal fica de fora | Mais generoso que a leitura mínima do art. 49, porque ainda não há aviso antes da renovação anual. Confirmar se a renovação mensal também precisa ser coberta |
| D9 | **Sem reembolso proporcional** depois dos 7 dias (o cancelamento só para as próximas cobranças), salvo falha nossa ou exigência legal | Procons às vezes exigem proporcionalidade em planos anuais. Avaliar o risco |
| D10 | Cosmético = **licença** enquanto a conta e o serviço existirem. Aviso de 90 dias se o serviço acabar. Perda "nos limites da lei" em banimento por violação grave | Conflita com a UI "para sempre" (P4). Decidir: (a) reembolso proporcional se o serviço acabar cedo; (b) se a perda por banimento é válida diante do CDC |
| D11 | **Sem teto de indenização.** A responsabilidade segue o CDC | Cláusula que limita ou exonera responsabilidade perante consumidor é nula (CDC, art. 51, I). Não foi incluído nenhum teto |
| D12 | Licença do conteúdo do usuário: **mundial, gratuita, não exclusiva, só para operar o serviço**, terminando quando o conteúdo é apagado (salvo backups) | "Mundial" porque a hospedagem fica nos EUA. Inclui recodificar imagens. Exclui expressamente IA, anúncios e venda |
| D13 | Mensagens depois da exclusão da conta: **a pessoa escolhe** entre apagar tudo ou manter como "Usuário excluído" | Ponderar o direito de eliminação (art. 18, VI) com o histórico da conversa dos outros participantes. **Implementado com o padrão "anonimizar"**: o texto fica sob um único "Usuário removido", então as mensagens de quem saiu não se ligam entre si. Anexos e avatar sempre são apagados. Confirmar o padrão |
| D14 | Prazos: conta excluída apagada em 30 dias; backups até 3 meses; moderação 6 meses após o fim do caso; fiscal ~5 anos; contas não verificadas 30 dias; logs técnicos conforme o provedor | Todos são propostas. Confirmar o fiscal com o contador. Os backups de 3 meses vêm de `deploy.md` §7 (mensal mantido 3 meses), ainda não configurados. **Implementado:** exclusão em 7 dias (dentro dos 30), casos de moderação 6 meses depois da decisão (exceto `csam`), registros de acesso 6 meses. Fiscal e contas não verificadas: ainda sem expurgo |
| D15 | A equipe acessa conteúdo só em denúncia, ordem judicial ou incidente | Sem E2EE é tecnicamente possível. Confirmar se a redação "não lemos por rotina" é suficiente e honesta |
| D16 | **30 dias** de aviso para mudanças relevantes nos Termos e nos preços | Prática comum. Confirmar |
| D17 | Denúncia sobre direitos de criança ou adolescente **identifica quem denuncia** | O art. 29, §2º, veda a denúncia anônima para remoção sem ordem judicial. Confirmar se outras denúncias podem ser feitas sem esse requisito (a denúncia no app já é autenticada) |
| D18 | Encarregado nomeado, sem uso da dispensa de pequeno porte | Res. 2/2022: dados de adolescentes são critério específico de alto risco, que afasta o tratamento diferenciado. Confirmar se também é preciso o critério geral (larga escala) |
| D19 | Voz e tela **não são dado sensível**: sem gravação, sem reconhecimento de voz, só encaminhadas em tempo real | Confirmar que não há tratamento biométrico (LGPD, art. 5º, II) |
| D20 | O hook global de teclado e mouse (atalhos) está descrito com clareza suficiente | Ele observa todas as teclas enquanto há atalhos configurados, mas só compara localmente (`hotkeys.ts`). Avaliar se é preciso um aviso no momento da configuração |
| D21 | Destinatário da comunicação do art. 27 (abuso infantil) | **Respondido em 2026-11-01:** Polícia Federal, no CNCA ("Centro Nacional de Triagem de Notificações"), pelo Sistema Nidus. Base: Decreto 12.880/2026, arts. 36 a 39, e Portaria MJSP 1.312/2026. Depois que a PF confirma o recebimento, o material é apagado (art. 39, §2º). O cadastro no Nidus é obrigatório. Detalhes em `docs/trust-safety/csam-process.md`. A portaria em si não foi lida |
| D22 | Foro no domicílio do consumidor | CDC, art. 101, I. Nenhuma cláusula de eleição de foro |
| D23 | Porta lógica de origem nos registros de acesso | O Marco Civil fala só de IP, mas a jurisprudência do STJ costuma exigir a porta por causa do CGNAT. Atrás do proxy do Railway a porta do cliente pode não chegar à API. **Continua aberto:** `access_logs` grava IP, data, hora e hash do user agent, mas não a porta |

## 4. Afirmações que precisam continuar verdadeiras

Se o código mudar, estes trechos mudam junto. Cada linha diz onde a afirmação está no código.

- "Sem E2EE; o SFU pode ver a mídia": `docs/ARCHITECTURE.md` (Segurança).
- "Sem telemetria; relatórios de travamento não são enviados": `crashReporter.start({ uploadToServer: false })` em
  `apps/desktop/src/main/log.ts`. Não há SDK de analytics no app.
- "Sessões sem IP": `sessions` em `schema.ts` só tem `user_agent`, `created_at` e `last_used_at`. Isso continua
  verdade. O IP de cada uso está em `access_logs` desde a migração 0005 (L6), e a linha "Registros de acesso" da
  Política deve dizer isso.
- "A identidade de quem denuncia não é revelada": `reports.reporter_id` só aparece em `/admin/reports`, que exige
  papel de equipe (`src/routes/admin.ts`).
- "Data de nascimento usada só para aferir idade": `birth_date` só é lida por `ageBracketOf` (`src/legal.ts`) e pela
  exportação da própria pessoa.
- "Imagens sem metadados, exceto HEIC/TIFF/BMP/RAW" e "sem antivírus": `apps/server/README.md` (Lacunas conhecidas).
- "Cancelar no app; benefícios até o fim do período; 3 dias de carência": `src/billing/` e `apps/server/README.md`.
- "Grátis: 720p30/720p60/1080p30 e 25 MB. Plus: 1080p60/1440p60/4K30 e 100 MB": `catalog.ts` e
  `MAX_ATTACHMENT_BYTES`. Os preços ainda são **proposta** (`monetization.md` §0).
- "Nada de caixa de sorte nem moeda virtual": `monetization.md` §3. Também é exigência do art. 20 da Lei
  15.211/2025, se o produto um dia tiver jogos.

## 5. Fontes externas (acesso em 2026-11-01)

1. Lei 15.211/2025 (ECA Digital), texto compilado: arts. 1º, 2º, 7º, 9º, 12–14, 17, 18, 20–31, 35, 40 e 41-A
   (vigência em 17/03/2026). https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15211.htm
2. Convergência Digital, 20/03/2026: orientações preliminares da ANPD sobre aferição de idade. Autodeclaração "pouco
   confiável"; adaptação de ago. a nov./2026; fiscalização a partir de jan./2027.
   https://convergenciadigital.com.br/governo/anpd-define-primeiras-orientacoes-sobre-verificacao-de-idade-em-plataformas-digitais/
3. ANPD, "Mecanismos confiáveis de aferição de idade — orientações preliminares" (PDF criado em 19/03/2026). O
   conteúdo não pôde ser lido pela ferramenta; foi usado pela fonte 2.
   https://www.gov.br/anpd/pt-br/assuntos/eca-digital/mecanismos-confiaveis-de-afericao-de-idade-orientacoes-preliminares.pdf
4. Decreto 12.880/2026 (regulamenta o ECA Digital, publicado em 18/03/2026). Conhecido só pelos resultados de busca
   (Mattos Filho, que deu 403; Mayer Brown, 23/04/2026). **O texto não foi lido.**
   https://www.mattosfilho.com.br/unico/decreto-regulamentar-eca-digital/
5. LGPD (Lei 13.709/2018), texto compilado: arts. 14, 16, 18, 19, 33, 41, 46 e 48.
   https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
6. Marco Civil da Internet (Lei 12.965/2014): arts. 5º, VIII; 7º, VIII e X; 15; 16.
   https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
7. Resolução CD/ANPD nº 19/2024 (cláusulas-padrão): fim do prazo de adequação em 23/08/2025.
   https://lefosse.com/noticias/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/
8. Resolução CD/ANPD nº 18/2024 (encarregado), art. 8º.
   https://www.tjba.jus.br/extrajudicial/wp-content/uploads/2024/08/RESOLUCAO-ANPD-No-18-Encarregado-de-Dados.pdf
9. Resolução CD/ANPD nº 2/2022 (pequeno porte), arts. 3º, 4º e 11 (comentário de terceiros; conferir no DOU).
   https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2022/02/regulation-for-the-application-of-the-general-data-protection-law-lgpd-for-small-business-data-processing-agents/legal-update--regulamento-agentes-de-pequeno-porte.pdf
10. STF, Temas 987 e 533 (art. 19 do Marco Civil, 26/06/2025): o art. 19 continua valendo para mensageria privada
    nas comunicações pessoais. https://www.mattosfilho.com.br/unico/responsabilizacao-provedores-internet/ e
    https://teletime.com.br/26/06/2025/art-19-stf-concilia-votos-e-plataformas-terao-responsabilizacao-parcial/
11. PL 4983/2026 (cancelamento e renovação automática, protocolado em 11/08/2026). Não há lei federal sancionada.
    https://atlaspublico.com.br/camara/noticias/deputado-pastor-gil-pl-ma-apresenta-pl-que-garante-78727
12. DPAs dos fornecedores (citam cláusulas-padrão da UE): https://railway.com/legal/dpa e
    https://resend.com/legal/dpa

**Não reconsultados nesta sessão** (texto conhecido; conferir antes de publicar):

- CDC (Lei 8.078/1990), arts. 30, 37, 49, 51 e 101:
  https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm
- Decreto 7.962/2013, arts. 2º, 4º e 5º:
  https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm
- Código Civil, arts. 3º a 5º e 171.
- Resolução CD/ANPD nº 15/2024 (incidentes).
