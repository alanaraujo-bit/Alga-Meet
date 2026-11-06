# Pesquisa competitiva: Discord (2026-11-05)

Pesquisa para orientar decisões de produto do Alga Meet. **Somente pesquisa:** nada do produto foi alterado.

## Comece por aqui

**[05 — Resumo executivo](05-executive-brief.md).** As 10 descobertas mais importantes, as decisões e o que validar. São 5 minutos de leitura.

## Documentos

| # | Documento | O que tem | IDs |
|---|---|---|---|
| 01 | [Voz do cliente](01-voice-of-customer.md) | 1.699 avaliações (Play pt-BR e en-US, App Store BR): temas, frequências, linha do tempo, o que amam, a pergunta central | `VOC-01..15` |
| 02 | [Auditoria de experiência](02-product-experience-audit.md) | 27 funcionalidades do Discord Web observadas ao vivo, crítica de UX/UI medida, princípios, atritos | `PX-01..27`, `F1..F10`, `OP-01..17` |
| 03 | [Oportunidades competitivas](03-competitive-opportunities.md) | Cruzamento de 01 e 02, o caso ANPD/ECA Digital, onde o Alga Meet está, o que preservar, apostas e riscos | `CO-01..14` |
| 04 | [Backlog priorizado](04-prioritized-backlog.md) | 30 itens P0–P3 com notas, esforço, horizonte, estado atual e evidência | `BL-01..30` |
| 05 | [Resumo executivo](05-executive-brief.md) | Para o dono: síntese e decisões | — |

## Achar um tema

| Tema | Onde |
|---|---|
| Brasil sem vídeo do Discord (ANPD, ECA Digital, AGU) | 03 §2 · VOC-09 · BL-01 |
| Confiabilidade de mensagens e atualizações | VOC-01 · BL-02 |
| Voz e chamadas | VOC-02 · PX-07 · PX-27 · BL-03 · BL-05 |
| Cadastro, login e migração do grupo | VOC-03 · PX-20 · BL-04 · BL-15 |
| Monetização (Nitro, Loja, Missões, Impulsos) | VOC-08 · VOC-15 · PX-22..25 · BL-08 · BL-16 |
| Notificações, não lidos e caixa de entrada | VOC-11 · PX-13 · PX-14 · PX-18 · BL-07 · BL-11 |
| Busca, Quick Switcher e atalhos | PX-02 · PX-03 · PX-15 · BL-10 |
| Moderação, bans, suporte e confiança | VOC-04 · VOC-05 · PX-19 · BL-12 |
| Segurança infantil e verificação de idade | VOC-10 · BL-01 · BL-19 |
| Redesigns, layout e design visual | VOC-06 · PX-01 · 02 §4.3 · BL-14 |
| Desempenho e peso | VOC-07 · BL-13 |
| Comunidades grandes (canais, fórum, primitivas) | PX-07..09 · BL-21 · BL-22 |
| Acessibilidade | PX-26 · BL-18 |
| O que as pessoas amam e não podemos perder | 01 §5 · 03 §4 |
| Ideias atraentes de baixo valor | 01 §7 · 03 §5 |

## Método, em resumo

- **Coordenação:** um agente coordenador e dois agentes em paralelo, com o parâmetro `model: opus` (Claude Opus 5.5) e `effort: medium` da ferramenta de agentes.
- **Agente 01 (voz do cliente):** navegador embutido, sem login, mais a chamada pública que o próprio diálogo de avaliações do Play usa.
- **Agente 02 (auditoria):** o Chrome do dono, com o Discord Web já autenticado, só lendo e navegando. Nada foi enviado, nada foi alterado e ninguém foi chamado. Por ordem do dono, a documentação oficial não substituiu observação.
- **Coordenador:** cruzamento, verificação externa do caso ANPD na imprensa e conferência do estado do Alga Meet no código.

## Privacidade e dados

O repositório é público. Os dados brutos (avaliações coletadas, sem nomes nem avatares) ficam em `docs/private/research/discord/`, que o git ignora. Estes documentos não contêm:
- nomes de pessoas ou de servidores privados;
- conteúdo de mensagens;
- citações longas.

Os ponteiros `pt:Lnnn`, `en:Lnnn` e `ap:Lnnn` indicam a linha no arquivo bruto correspondente.

## Pesquisas anteriores relacionadas

- [`../discord-benchmark.md`](../discord-benchmark.md): voz, tela, recursos e preços.
- [`../discord-profile-study.md`](../discord-profile-study.md): perfil, presença e loja de perfil.
