# 03 — Oportunidades competitivas: cruzamento das duas pesquisas

> Coordenador da pesquisa, 2026-11-05. Cruza a voz do cliente ([01](01-voice-of-customer.md), itens `VOC-xx`) com a auditoria do produto ([02](02-product-experience-audit.md), itens `PX-xx`, atritos `F1–F10` e oportunidades `OP-xx`), e acrescenta uma verificação externa sobre o Brasil (§2).
> As oportunidades deste documento usam o prefixo `CO-xx`. O backlog ([04](04-prioritized-backlog.md)) aponta para elas.
>
> **Rótulos:** **[FATO]** observado ou verificado · **[HIPÓTESE]** inferência nossa · **[RECOMENDAÇÃO]** o que sugerimos.

---

## 1. Onde o Alga Meet está hoje (só o que importa para o cruzamento)

Conferido no código em 2026-11-05. Serve para separar "já temos", "parcial" e "falta", e não para avaliar qualidade.

| Capacidade | Estado no Alga Meet | Evidência |
|---|---|---|
| Voz, transmissão de tela, palco | **Tem** (núcleo do produto; H.265 por hardware, 1080p, presets por plano) | `docs/STATE.md` (Qualidade) |
| E2EE em chamadas | **Tem** (DMs sempre; espaços opcional) | `docs/decisions/0004-e2ee.md` |
| Espaços, canais, cargos, convites, moderação, denúncia e apelação | **Tem** | `apps/server/src/routes/{spaces,reports,admin}.ts`, `trust-safety.ts` |
| "Ativo agora", atividade em tempo real, status, perfil completo | **Tem** (release 0.1.4) | `features/activity`, `features/profile` |
| Soundboard | **Tem** (0.1.3) | `features/soundboard` |
| Quick Switcher | **Parcial**: lugares, pessoas **e ações**; não busca mensagens | `features/switcher/QuickSwitcher.tsx` |
| Busca de mensagens | **Falta** | nenhuma rota `/search` no servidor |
| Prévia da sala antes de entrar | **Falta**: clicar no canal de voz entra direto (igual ao Discord) | `features/shell/Sidebar.tsx:209` |
| Caixa de entrada, notificação padrão por espaço, seguir canais | **Falta** (só o aviso "entrou na voz" tem preferência) | `db/schema.ts` (`voice_notify_prefs`) |
| Mensagens de voz, fórum, tópicos | **Falta** | — |
| Cadastro | e-mail + senha, verificação de e-mail, **data de nascimento e idade mínima 16** (Lei 15.211/2025); sem captcha visual, sem login social | `routes/auth.ts`, `MIN_AGE` em `packages/shared/src/trust-safety.ts` |
| Monetização | Plus R$ 14,90; cosméticos avulsos; **Casa** (compra do grupo para o espaço); presentes; voz igual para todos no grátis | `docs/business/monetization.md`, `apps/server/src/billing` |

---

## 2. A descoberta que muda o tabuleiro: o Brasil perdeu o vídeo do Discord

**[FATO, verificado em fontes públicas pelo coordenador]**
- Em **12/08/2026**, a ANPD determinou a suspensão do **Go Live e de recursos equivalentes de vídeo** do Discord no Brasil, com base no **ECA Digital (Lei 15.211/2025, em vigor desde 17/03/2026)**. O Discord cumpriu a ordem em **17/08/2026**.
  - **Suspenso:** compartilhamento de tela, câmera e chamadas de vídeo.
  - **Continua funcionando:** texto, servidores e voz.
- **Motivos apontados pela ANPD:**
  - falta de medidas razoáveis contra indução à automutilação e ao suicídio;
  - a plataforma não tem acesso em tempo real ao conteúdo das transmissões em servidores privados;
  - uma mudança no Go Live, pouco antes da vigência da lei, que o deixou menos protetivo para menores.

  O caso seguiu a morte de uma adolescente de 13 anos depois de uma transmissão num servidor privado ([Canaltech](https://canaltech.com.br/internet-e-redes-sociais/discord-suspende-transmissoes-ao-vivo-no-brasil-apos-ordem-da-anpd-entenda-o-que-muda), [AP via The Star](https://www.thestar.com.my/tech/tech-news/2026/08/18/discord-halts-livestreams-in-brazil-after-watchdog-cites-child-safety-failures)).
- **Condições para voltar:** autorização prévia e expressa da ANPD, com prova de medidas técnicas e de governança. A sanção pode chegar a R$ 50 milhões por infração (Canaltech).
- **Ação da União:** a AGU processou o Discord em cerca de R$ 500 milhões por falhas de verificação de idade e de vinculação a responsáveis ([The Next Web](https://thenextweb.com/news/brazil-agu-discord-97m-lawsuit-eca-digital)).
- **Status em 2026-11-05:** não encontramos notícia de retomada. As avaliações recentes (até 04/11) ainda reclamam da falta de tela e câmera (VOC-09). **[HIPÓTESE]** A suspensão continua. A página de suporte do Discord sobre o tema devolveu 403 e não foi lida.

**Por que isso importa tanto:**

| Lado | Leitura |
|---|---|
| **Oportunidade [HIPÓTESE forte]** | Grupos brasileiros perderam o ritual de "ver filme e jogar junto" (VOC-09; "ver filme e jogo juntos" é o 6º motivo de amor nas 4–5★, VOC §5). É uma demanda órfã, recente e nacional, exatamente o núcleo do Alga Meet (tela de alta qualidade). |
| **Risco [FATO jurídico + HIPÓTESE de aplicação]** | O Alga Meet tem o **mesmo perfil de risco** que motivou a ordem: vídeo ao vivo em grupos privados, que a plataforma não vê. Com o **E2EE**, além de não ver, **não pode ver** por desenho. Divulgar "aqui dá pra transmitir" sem um pacote de conformidade convida a mesma medida. Sem parecer jurídico, isso é aposta, não plano. |

**[RECOMENDAÇÃO]**
- Tratar "transmissão no Brasil com conformidade ao ECA Digital demonstrável" como decisão estratégica número 1 (CO-01).
- O caminho provável: transmissão e câmera só para contas **adultas com idade aferida** de forma pouco invasiva, padrões protetivos e denúncia dentro da chamada. O que hoje está na lei se aplica a 16–17 anos, e o mínimo já é 16.
- **O produto não deve prometer nada antes do parecer.**

---

## 3. Matriz de cruzamento (queixa ↔ produto observado ↔ Alga Meet)

| CO | O que os usuários sentem (01) | O que a auditoria mostra (02) | Alga Meet hoje | Oportunidade |
|---|---|---|---|---|
| **CO-01** | Perderam tela e câmera no Brasil (VOC-09); querem segurança sem entregar documento (VOC-10) | Go Live não observado (dentro da chamada); MFA explicado e "Ignorar < Bloquear" bem feitos (PX-19, PX-06) | Tela é o núcleo; E2EE; idade mínima 16 | **Transmissão "assistir junto" em conformidade com o ECA Digital**: idade aferida, padrões protetivos, denúncia na chamada, transparência |
| **CO-02** | Voz cai, emudece, briga com o jogo; mic morre ao compartilhar tela (VOC-02, 21,7%) | Clicar na voz entra direto (F1); sem teste de mic no menu rápido (PX-27) | Voz forte; entra direto ao clicar | **Voz que não falha + prévia da sala + checagem de mic pré-voz** |
| **CO-03** | Captcha em loop, SMS, login (VOC-03; 39% das 1–2★ recentes) | Moldes de servidor bons, mas não configuram tudo nem geram convite de WhatsApp (PX-20) | E-mail + senha + nascimento; sem captcha visual | **"Entrei em 20 s pelo convite do meu amigo"**: migração do grupo inteiro |
| **CO-04** | "Tudo é Nitro", botão de presente em lugar de clique acidental (VOC-08; 15% em en) | Metade das entradas fixas da Home são comerciais; upsell no popout; Boost como 1º item do menu; contadores e "-37%" (F7, PX-22/24/25) | Plus, cosméticos, Casa; loja própria | **Monetização honesta**: zero comércio no chrome do app, sem escassez artificial, pago melhora o grupo de forma finita |
| **CO-05** | Atualizações quebram o básico, redesigns impostos (VOC-01, VOC-06) | Base visual sóbria, superfície barulhenta (§4.3 do 02) | Direção Linear; release com checagem de pacote | **Estabilidade como recurso**: caminho crítico testado, mudanças de layout opcionais, densidade |
| **CO-06** | App pesado, gasta bateria e FPS (VOC-07) | — (não medido na web) | Benchmark interno propõe ≤ 1/3 da memória do Discord | **Orçamento de desempenho público**, medido a cada release |
| **CO-07** | Notificação que não chega, "não perturbe" que não silencia (VOC-11) | Contadores 68 e "(72)" no título; 3 níveis de notificação; padrão "todas as mensagens" (F5, PX-14, PX-18) | Sem inbox, sem padrão por espaço | **Notificação calma e confiável**: padrão adaptativo, inbox como tela, DND real |
| **CO-08** | Ban coletivo e por IA sem apelação; suporte robô (VOC-04, VOC-05) | Bloqueio explicado com "Resolver" (PX-19); "Status da conta — Tudo certo!" (PX-16) | Denúncia, apelação e staff já existem | **Confiança visível**: motivo da punição, apelação humana com prazo, recuperação de conta em camadas |
| **CO-09** | Querem achar coisas, mas pouco reclamam de busca (0,9%) | Duas buscas com sintaxes diferentes (F4, PX-02, PX-15) | Switcher com ações; sem busca de mensagens | **Uma paleta só** (lugares, pessoas, mensagens, ações) |
| **CO-10** | Amam servidores, cargos, bots, "call enquanto joga" (VOC §5) | Lugares persistentes, "Ativo agora", ocupação "00/05" (princípios 1–2 do 02) | Espaços, "Ativo agora", atividade em tempo real | **Home "Agora"**: quem está em qual sala, em todos os espaços, com entrada explícita |
| **CO-11** | Mensagens de voz no estilo WhatsApp (VOC-13, quase só BR) | — | Falta | Áudio rápido com fila e 1,5×/2× |
| **CO-12** | Paridade e várias contas (VOC-12) | — | Só Windows | Modelo de dados para várias contas; mobile depois, sem rebaixar quem só tem celular |
| **CO-13** | — (donos de comunidade não escrevem na Play) | Gambiarras: voz bloqueada como contador, canal-isca antispam, emoji como ícone (F8) | Falta | **Primitivas nativas de comunidade** |
| **CO-14** | Sobrecarga em servidores grandes (indireto) | "Conferir Canais" é o melhor antídoto e está enterrado (PX-09) | Falta | **Seguir canais por padrão** em espaços grandes |

---

## 4. O que preservar (populares e arriscados de perder)

Base: VOC §5 (o que as 4–5★ elogiam) e os princípios do 02 §5.

1. **Servidor → canais → cargos, com convite por link.** É o que os usuários chamam de genial (VOC §5). Não "simplificar" para lista de grupos.
2. **Lugares persistentes de voz com ocupação visível** (princípio 1 do 02). É o coração do "call enquanto joga".
3. **Comunicação completa de graça.** O elogio "tudo de graça" e a queixa "tudo é Nitro" são a mesma fronteira (VOC-08).
4. **Identidade sem telefone e presença em vários dispositivos** (VOC §5).
5. **Controles finos de voz:** volume por pessoa, perfis de entrada, soundboard (PX-27, VOC §5).
6. **Segurança graduada:** Ignorar < Silenciar < Bloquear, notas privadas (PX-06, PX-11).
7. **Teclado de primeira classe** e sintaxe ensinada no uso (PX-02, PX-03).
8. **Padrão no grupo, ajuste no indivíduo** (PX-18, PX-09).
9. **Gestos sociais de custo zero:** acenar para quem chegou (PX-10).
10. **Acessibilidade abrangente com prévia ao vivo** (PX-26).

## 5. Ideias que parecem boas, mas valem pouco (por ora)

| Ideia | Por que não agora | Fonte |
|---|---|---|
| Quests, Orbs, anúncios recompensados | Contraria a direção premium e sem dark patterns; o próprio público pede *mais* anúncio, o que reforça o risco | VOC-15, PX-23 |
| Descoberta pública de comunidades | Depende de massa crítica e de moderação de catálogo; o valor inicial está nos grupos de amigos | PX-21 (OP-17) |
| "Visto/lido" estilo WhatsApp | Pressão social e ruído em servidores; no máximo opcional em DM | VOC §7 |
| Tradução embutida, ranking de conta | Pedidos raros ou isolados | VOC §7 |
| Mais cosméticos e efeitos em listas | Já poluem a lista de membros no Discord | PX-12 (OP-15) |
| Inventário de presentes com insígnia de progressão | Gamifica gasto | PX-22 |

## 6. Fundamentais para competir (sem isso não há troca)

Estes não diferenciam no marketing, mas sua falta impede a migração do grupo:
- **Mensagem que sempre chega:** estado explícito de envio, reenvio e retomada de conexão (VOC-01).
- **Voz estável com o jogo aberto** e tela sem derrubar o mic (VOC-02).
- **Entrada sem atrito pelo convite** (VOC-03).
- **Padrões calmos de notificação** (F5, VOC-11).
- **Nada de ação implícita:** "digitando" só com conteúdo, Esc só fecha, sem entrada acidental na voz (F1–F3).
- **Conformidade com o ECA Digital** em tudo que tem vídeo ao vivo (§2).

## 7. Onde podemos ser radicalmente diferentes

Cada aposta tem base nas duas pesquisas e combina com a direção do produto.

| Aposta | Por que pode distinguir | Base | Risco principal |
|---|---|---|---|
| **"Assistir junto" legal no Brasil** | Demanda órfã desde 08/2026, exatamente nosso núcleo técnico | §2, VOC-09 | Regulatório (ANPD, E2EE); só com parecer |
| **Migração do grupo em minutos** | A fidelidade é à rede, não ao app (VOC §6); quem tira o grupo ganha | VOC-03, PX-20 | Exige convite com criação de conta e, idealmente, importar estrutura |
| **App calmo e honesto** | Contraste direto com o comércio no chrome e com a ansiedade dos contadores | F5, F7, VOC-08 | Monetização precisa fechar sem upsell agressivo |
| **Velocidade de teclado tipo Linear** | Paleta única, inbox com triagem, atalhos visíveis | PX-02, PX-13, PX-15 | Busca full-text é engenharia alta |
| **Confiança operacional visível** | "Aqui você fala com gente": apelação humana, motivo da punição, recuperação de conta | VOC-04, VOC-05 | Custo de operação humana |

## 8. Riscos do cruzamento

- **Regulatório (o maior):** ECA Digital, ANPD e a ação da AGU mostram fiscalização ativa. E2EE e vídeo ao vivo em grupos privados é a combinação mais sensível (§2).
- **Efeito de rede:** sem facilitar a migração em grupo, qualidade superior não basta (VOC §6).
- **Amostra:** a voz do cliente é mobile (Play), e o Alga Meet começa no desktop. As queixas de voz e de peso se transferem como princípio, não como requisito literal (01 §2, L4).
- **Pontos cegos da auditoria:** UI dentro da chamada, cargos e permissões, AutoMod e auditoria **não foram observados** (02 §8). As recomendações sobre esses temas valem menos.

## 9. O que validar antes de entrar no roadmap

| Validação | Por quê | Como |
|---|---|---|
| Parecer jurídico: ECA Digital + vídeo ao vivo + E2EE | Decide se e como CO-01 existe | Advogado; ver `docs/legal/review-notes.md` (L1, L10, F1) |
| Status atual da suspensão do Discord | Se voltou, a janela muda | Página da ANPD e suporte do Discord |
| Teste de 5 grupos de amigos migrando | Mede o "20 s pelo convite" na prática | Sessões moderadas com grupos reais |
| Dor de voz no desktop | A amostra é mobile | Fórum, Reddit ou entrevistas com quem joga no PC |
| UI dentro da chamada, cargos, AutoMod, auditoria do Discord | Lacuna da auditoria | Servidor de teste **privado**, criado com autorização do dono e apagado depois |
| Disposição a pagar pelo "pago melhora o grupo" (Casa) | Base de CO-04 | Teste de preço com o beta fechado |
