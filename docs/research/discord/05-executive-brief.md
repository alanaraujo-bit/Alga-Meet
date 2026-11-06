# 05 — Resumo executivo: Discord, o que aprender e onde vencer

> Para o dono do projeto. 2026-11-05. Base: 1.699 avaliações públicas ([01](01-voice-of-customer.md)), auditoria ao vivo de 27 funcionalidades do Discord Web ([02](02-product-experience-audit.md)), cruzamento ([03](03-competitive-opportunities.md)) e backlog ([04](04-prioritized-backlog.md)).
> As porcentagens valem só para a amostra, que foi estratificada por estrelas. Elas não representam todos os usuários.

## Em uma frase

As pessoas amam **os amigos e os servidores** que estão no Discord, não o app. Quem oferecer o mesmo lugar com o básico funcionando, sem comércio no caminho e com uma forma de **trazer o grupo inteiro**, tem espaço. No Brasil existe hoje uma janela aberta, e com ela uma armadilha regulatória.

---

## As 10 descobertas mais importantes

Em ordem de relevância estratégica.

1. **O Discord está sem vídeo no Brasil desde 17/08/2026.**
   - A ANPD suspendeu Go Live, compartilhamento de tela e câmera com base no ECA Digital. A AGU processa a empresa em cerca de R$ 500 milhões.
   - "Ver filme e jogar junto" virou demanda órfã, e é o núcleo técnico do Alga Meet.
   - **Temos o mesmo perfil de risco**, agravado pelo E2EE: vídeo ao vivo em grupo privado que a plataforma não vê.
   - É a maior oportunidade e o maior risco ao mesmo tempo. Fonte: 03 §2, VOC-09.
2. **A fidelidade é à rede, não ao produto.**
   - 32,8% das 3★ abrem com elogio e viram com "mas".
   - Ninguém elogia o cliente em si. Pouca gente cita alternativa, porque ninguém migra sozinho.
   - **Vence quem facilitar a migração do grupo inteiro.** Fonte: 01 §6.
3. **O básico que falha é a queixa número 1.**
   - 44,7% das 1–2★ (pt-BR) falam de confiabilidade: crash, mensagem que não envia, "piorou depois da atualização".
   - Mensagem e voz que nunca falham são condição para existir, não diferencial. Fonte: VOC-01.
4. **A porta de entrada é a dor mais nova.**
   - Nas 1–2★ recentes (jul–nov/2026), 39% falam de cadastro ou login: captcha em loop, SMS que não chega.
   - Quem não entra nunca vê qualidade nenhuma. Fonte: VOC-03.
5. **A voz é ao mesmo tempo o maior amor e a maior queixa técnica.**
   - Ela é o 2º motivo de amor ("call com os amigos enquanto jogo"), e 21,7% das 1–2★ reclamam de queda, mudez ou briga com o jogo.
   - O que mais fazemos bem precisa ser à prova de bala. Fonte: VOC-02.
6. **O Discord virou vitrine.**
   - Metade das entradas fixas da Home é comercial. Tem upsell no popout do perfil, impulso como 1º item do menu do servidor, contadores de escassez ("9 DIAS RESTANTES", "-37%") e missões patrocinadas com prazo.
   - Usuários percebem: "tudo é Nitro" aparece em 15% das 1–2★ em inglês.
   - **Monetização honesta é diferencial fácil de explicar.** Fonte: 02 §4.5, PX-22–25, VOC-08.
7. **Clicar numa sala de voz entra nela, no Discord e no Alga Meet.**
   - É entrada acidental que todos veem.
   - Uma prévia ("quem está aqui · Entrar") é barata e muda a sensação de controle. Fonte: F1, `Sidebar.tsx:209`, BL-05.
8. **Notificação: ansiedade de um lado, silêncio do outro.**
   - Contadores como 68 e "(72)" no título convivem com queixas de notificação que não chega.
   - Os melhores antídotos do Discord (notificação padrão por servidor, "Conferir Canais") estão enterrados.
   - **Padrões calmos de fábrica.** Fonte: F5, PX-09, PX-18, VOC-11.
9. **Teclado e busca: o Discord tem duas buscas com duas sintaxes.**
   - Uma paleta única (lugares, pessoas, ações e mensagens), no estilo Linear, é coerente com a nossa direção.
   - Já temos metade: o switcher com ações. Fonte: F4, PX-02, PX-15, BL-10.
10. **Confiança operacional é o calcanhar do Discord.**
    - Ban por estar no servidor errado, IA que suspende sem apelação, suporte que responde com robô.
    - Ao mesmo tempo, pedem **mais** proteção infantil, mas rejeitam foto de documento.
    - "Aqui você fala com gente" e aferição de idade de baixo atrito são posições vencedoras. Fonte: VOC-04, VOC-05, VOC-10.

---

## O que o Discord faz excepcionalmente bem (preservar como conceito)

- **Lugares persistentes:** a sala de voz existe antes e depois de você e mostra a ocupação ("00/05").
- **Presença como motor de retorno:** "Ativo agora" traz gente de volta porque há gente, não por notificação.
- **Servidor → canais → cargos, com convite por link.** Os usuários chamam de genial.
- **Teclado de primeira classe:** ~46 atalhos, Ctrl+K útil antes de digitar.
- **Segurança graduada:** Ignorar < Bloquear, MFA explicado com "Resolver".
- **Prévia ao vivo** nas configurações, e uma acessibilidade abrangente.
- **"Pagar melhora o grupo":** os impulsos de servidor.

## O que mais incomoda

Confiabilidade (44,7%), entrada (24%; 39% nas recentes), voz (21,7%), redesigns impostos (10,9%), peso e bateria (10,4%) e paywall (15% em inglês). Percentuais sobre as 1–2★ pt-BR, salvo indicação. No Brasil, a novidade de 2026 é a perda de tela e câmera.

## O que as pessoas desejam e não encontram

- Entrar pelo convite sem loop nem telefone.
- Voz que aguenta o jogo aberto.
- App leve.
- Grátis de verdade no essencial.
- Gente de verdade no suporte e na apelação.
- Mudanças de interface que respeitam o hábito.
- No Brasil: assistir junto e mensagens de voz no estilo WhatsApp.

## Indispensável para competir (P0)

1. Mensagem que sempre chega (BL-02).
2. Voz resiliente com o jogo aberto (BL-03).
3. Entrar pelo convite em segundos (BL-04).
4. Conformidade com o ECA Digital em tudo que tem vídeo ao vivo (BL-01).
5. Prévia da sala (BL-05).
6. Sem ações implícitas (BL-06).
7. Notificação calma (BL-07).
8. Zero comércio no chrome do app (BL-08).

Os itens 5 a 8 são rápidos.

## Decisões que podem nos tornar superiores

| Decisão | Recomendação | Por quê |
|---|---|---|
| **Transmissão no Brasil** | Pedir parecer jurídico **antes** de divulgar. Caminho provável: tela e câmera para contas com idade aferida de forma pouco invasiva, padrões protetivos e denúncia dentro da chamada | Descoberta 1. Sem isso, o diferencial vira passivo |
| **Fronteira grátis × pago** | Comunicação completa grátis. Pago = expressão (cosméticos), excesso (limites altos) e grupo (Casa com meta finita) | Descobertas 3 e 6, VOC-08 |
| **Métrica norte** | "Grupos que migraram inteiros em < 1 dia" | Descoberta 2 |
| **Promessa pública de desempenho** | Orçamento de memória, CPU e FPS publicado e medido a cada release | VOC-07; demonstrável |
| **Promessa pública de confiança** | Motivo de toda punição, apelação humana com prazo, recuperação de conta em camadas | Descoberta 10 |

## O que validar antes do roadmap

1. **Parecer jurídico** sobre ECA Digital, vídeo ao vivo e E2EE (bloqueia a decisão 1).
2. **Status atual** da suspensão do Discord. Não achamos retomada até 05/11; as avaliações recentes ainda reclamam.
3. **Teste de migração** com 5 grupos reais de amigos: tempo até todos estarem numa call.
4. **Dor de voz no desktop.** A voz do cliente veio do celular (Play); falta ouvir quem joga no PC.
5. **Lacunas da auditoria:** UI dentro da chamada, cargos e permissões, AutoMod e auditoria do Discord. Só com um servidor de teste **privado**, criado com sua autorização e apagado depois.
6. **Disposição a pagar** pela Casa com meta de grupo.

## Volume real e limitações

- **Avaliações:** 1.699 analisadas: 1.169 Play pt-BR, 480 Play en-US e 50 App Store BR. 404 delas foram lidas à mão.
  - Codificação por dicionário, validada por amostra.
  - Há um buraco de 2025 a meados de 2026 entre as ordens "relevantes" e "recentes".
  - A comunidade de feedback do Discord estava inacessível.
- **Auditoria:** 27 funcionalidades observadas ao vivo pelo seu Chrome, só lendo e navegando, sem documentação como fonte.
  - Não observados: dentro da chamada, cargos e permissões, AutoMod, auditoria e diálogo de convite.
  - O cliente desktop não foi comparado.
- **Fatos externos (ANPD, AGU)** foram verificados na imprensa. A página de suporte do Discord devolveu 403.
