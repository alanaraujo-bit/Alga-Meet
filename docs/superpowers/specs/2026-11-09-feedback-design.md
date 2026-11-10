# Feedback — "Conta pro Eco"

> 2026-11-09. Desenho aprovado em conversa com o dono; o que está marcado **(decisão do desenho)** foi escolha minha e
> pode ser vetado na leitura. Mockup da direção escolhida:
> `.superpowers/brainstorm/408-1794265522/content/feedback-forma.html` (opção A).

## Por quê

Hoje só os amigos do dono usam o Alga Meet. Quando algo quebra ou alguém tem uma ideia, a pessoa fala com o dono por
fora, ele tenta descobrir se é só com ela e o porquê, e só então traz o caso para ser resolvido. Não existe lugar no
app para isso, e nada do contexto (versão, sistema, o que a pessoa fazia, log) chega junto.

Este projeto cria esse lugar: um cartão pequeno e vivo onde a pessoa conta um bug, um travamento, uma ideia ou um
elogio em uma frase, e o app manda junto o que o dono sempre precisa perguntar. O que chega fica guardado no servidor.
Um painel administrativo futuro vai ler esses envios; **ele não faz parte deste projeto**.

## O que o dono pediu (palavras dele)

- Um lugar para reportar bugs, travamentos e sugerir melhorias.
- Agradável, intuitivo, bonito, animado, fluido, criativo, prazeroso; pensado de ponta a ponta; sucinto para quem usa.
- Mais vivo que a Central de Novidades (ele não gostou muito dela e vai ajustá-la depois). Novidades é referência de
  estrutura de código, não de visual.
- **Discreto**: não é algo muito usado, então não pode ficar à mostra como Novidades nem atrapalhar o que importa,
  como os grupos. Nada no rail.
- Privado, um a um, com o Eco (direção A do mockup). Sem mural público.
- Por enquanto ninguém lê os envios em tela nenhuma. Foco só na experiência de quem envia e em guardar bem.

## Objetivos

1. Contar algo leva segundos: um campo, um tipo, enviar.
2. O envio chega com contexto suficiente para o dono não precisar perguntar "qual versão?", "o que você fazia?".
3. A pessoa vê exatamente o que vai junto antes de enviar, e pode tirar o que quiser.
4. A experiência tem vida: o Eco e a luz reagem ao tipo, à digitação, ao print, ao envio.
5. Nada digitado se perde (rascunho, falha de rede, fechar sem querer).
6. Os dados ficam prontos para um painel futuro, sem retrabalho de esquema previsível.

## Fora do escopo

- Qualquer tela para a equipe ler, responder, filtrar ou mudar estado.
- Estados além de "Recebido", respostas da equipe, notificações de mudança.
- Mural público, votos, ver envios de outras pessoas.
- Editar ou apagar um envio já feito (ele some com a conta, como o resto).
- Envio automático de travamento sem a pessoa (os minidumps continuam só no PC).
- Formulário no site, feedback anônimo, traduções (o app é pt-BR; segue assim).

## O que tornaria isto um fracasso mesmo funcionando

- Um ícone fixo no rail ou qualquer coisa perto dos grupos.
- Um modal que trava o app, ou um passo a passo com várias telas.
- Mandar log ou print que a pessoa não viu.
- Aparecer sozinho no meio de uma chamada, transmissão ou jogo.
- Perder o texto que a pessoa escreveu.
- Parecer um formulário de suporte genérico.

## A experiência

### Onde abre

Sem ícone fixo. Três entradas, todas discretas:

- **Ctrl K** › ação "Enviar feedback" (`features/switcher/QuickSwitcher.tsx`, junto de Configurações).
- **Menu do seu usuário** (popover do canto inferior esquerdo, `features/shell/UserPanel.tsx`): item "Enviar feedback",
  acima de Sair.
- **Configurações › Avançado**: uma linha "Feedback" ao lado de "Ver novidades" e dos logs.

### O cartão

Um cartão compacto (≈ 400 px de largura), flutuando no canto inferior esquerdo, acima do painel do usuário, abra por
onde abrir. **Não é modal** (decisão do desenho): sem scrim, o app continua usável por trás, então dá para reproduzir
o problema ou navegar até a tela certa com o cartão aberto. Esc (com o foco nele) ou o × fecham; o rascunho fica.

De cima para baixo:

1. **Eco** (corpo inteiro, ≈ 90 px) sobre uma poça de luz suave, no matiz do tipo escolhido.
2. **A pergunta**, que muda com o tipo.
3. **Tipo**: quatro pílulas. Ideia vem escolhida.

   | Tipo | Matiz (token) | Pergunta | Eco ao escolher |
   |---|---|---|---|
   | Bug | `--danger` | "Eita. O que deu errado?" | `listening` |
   | Travou | `--warning` | "Travou? O que você fazia na hora?" | `error` por ~1 s |
   | Ideia | `--accent` | "Boa! Qual é a ideia?" | `success` (pulinho) |
   | Elogio | `--success` | "Opa. Do que você gostou?" | `success` (pulinho) |

4. **Texto**: um campo só, obrigatório, até 2000 caracteres, placeholder com exemplo por tipo. Ctrl Enter envia.
5. **Print (opcional, um)**: colar imagem, arrastar para o cartão, ou o botão **"Tirar print do app"** (decisão do
   desenho): o cartão some por um instante, o app captura a própria janela e a miniatura entra no cartão. A
   miniatura tem × para tirar e a frase "Confira: o print mostra o que estava na tela."
6. **"Vai junto"**: uma linha discreta dizendo o que o app anexa sozinho, com "ver" que expande o conteúdo exato:
   - sempre: versão do app, sistema ("Windows 11"), onde a pessoa estava (tipo de tela, se em chamada, se
     transmitindo, se no Cinema; **nunca** nomes ou ids de espaço, canal ou pessoa);
   - em Bug e Travou: o log recente do app, ligado por padrão, com uma chave para tirar. Em Ideia e Elogio o log
     não vai.
7. **Enviar** e, embaixo, o link "Seus envios · N" quando houver algum.

### Vida (o que anima)

O dono quer mais vida do que o sistema de design costuma permitir. O acordo aqui: tudo que anima é `transform` e
`opacity`, curto, com as curvas de `ui/motion.ts`, e some com "Reduzir animações" (os estados continuam visíveis).

- **Abrir**: o cartão sobe 12 px do canto do painel do usuário com escala .96 → 1 (≈ 260 ms); o Eco entra 80 ms
  depois com o pulinho; a luz acende por último.
- **Trocar o tipo**: a luz, o contorno do Eco e o anel de foco do campo mudam de matiz juntos (≈ 450 ms); o Eco faz a
  reação da tabela; a pergunta troca com um fade curto.
- **Digitar**: o Eco olha para o texto (`listening`) e volta a `idle` 900 ms depois da última tecla.
- **Print entrou**: os olhos do Eco viram a telinha (`streaming`) por ~1 s; a miniatura cai no lugar com mola.
- **Enviando**: o botão vira spinner sem mudar de largura; o Eco fica em `connecting`.
- **Enviado**: o conteúdo some, o Eco cresce para o centro em `success`, seis folhas do logo abrem em leque e somem
  (fora do desenho do Eco; ele mesmo continua sem partículas), "Recebido. Valeu, {primeiro nome}!" e o envio aparece
  como uma linha com a etiqueta "Recebido". Botões "Enviar outro" e "Fechar"; sem ação, fecha sozinho em ~4 s.
- **Tentar enviar vazio**: o campo balança e o Eco faz `error` por um instante. Sem toast.
- **Falhou**: o Eco fica em `error`, a frase do servidor (ou "Sem conexão.") aparece no lugar do botão com "Tentar de
  novo". O texto e o print continuam lá.

### Seus envios

Dentro do mesmo cartão: a lista desliza no lugar do formulário, com ← para voltar. Cada linha: ponto na cor do tipo,
o começo do texto, a data, "com print" quando houver, e a etiqueta "Recebido". É texto fixo por enquanto; estado de
verdade e resposta da equipe chegam com o painel. Vazio: Eco `idle` e "Nada por aqui ainda."

### Depois de um travamento

O único momento em que o feedback se oferece sozinho. Se a sessão anterior terminou com o processo da interface
caindo ou com a janela sem responder, o app guarda um marcador local. (Erro não tratado no processo principal saiu
na construção: o app registra e segue rodando, então "travei" seria mentira; ele continua indo no log de qualquer bug.)
Na abertura seguinte, num momento calmo (a mesma regra das boas-vindas de Novidades, `isQuiet` em
`features/whatsnew/logic.ts`; e nunca junto com as boas-vindas: Novidades primeiro, isto no próximo momento calmo),
aparece um aviso pequeno no mesmo canto: Eco em `error`, "Travei da última vez. Quer me contar o que aconteceu?",
**Contar** e **Agora não**. "Contar" abre o cartão em Travou, com o log da sessão que caiu. Qualquer resposta
consome o marcador; a oferta acontece uma vez por travamento.

## Dados

### O envio

| Campo | Regra |
|---|---|
| tipo | `bug` · `crash` · `idea` · `praise` |
| texto | 1 a 2000 caracteres depois de aparar |
| versão do app, sistema | do cabeçalho `X-Alga-Client` que o app já manda em toda chamada (não gasta campo do multipart) |
| contexto | objeto pequeno e fechado: tipo de tela, em chamada, transmitindo, no Cinema, veio de travamento (motivo) |
| log | opcional, só em `bug`/`crash`; fim do `main.log`, no máximo 200 linhas e 48 KB **(decisão do desenho: por tamanho, não "últimos 2 minutos", para servir também ao travamento da sessão anterior)** |
| print | opcional, um, PNG/JPEG/WebP até 8 MB, limpo de metadados como os avatares |
| pessoa, data | da sessão |

### Servidor

- Tabela nova `feedback` (migração `0019`), dona = usuário, `on delete cascade`. O print fica no armazenamento de
  arquivos; a linha guarda a chave. Apagar a conta precisa remover o objeto também (existe a fila de remoção de
  objetos usada por anexos e avatares).
- `POST /feedback` (logado, multipart: 4 campos + 1 arquivo, dentro dos limites globais já configurados em
  `app.ts`), 10 por hora por pessoa; resposta com o envio criado.
- `GET /feedback/@me` (logado): os meus, mais novo primeiro, até 50: id, tipo, texto, data, se tem print.
- Sem rota de leitura para a equipe e sem rota para baixar o print: chegam com o painel.
- O envio anônimo de desinstalação (`POST /feedback/uninstall`, `uninstall_feedback`) fica como está.
- Contrato e limites em `packages/shared` (zod), como `releases.ts`.

### Privacidade

- O feedback entra na exportação de dados da pessoa (`privacy.ts`) e some com a conta.
- A Política de Privacidade (`docs/legal/politica-de-privacidade.md`, seção 2) ganha a linha do feedback: o que vai,
  para quê, até quando (enquanto a conta existir). **(Decisão do desenho: é uma finalidade nova iniciada pela própria
  pessoa, com tudo à mostra antes do envio; atualizar o texto sem criar versão nova em `LEGAL_VERSIONS`, que forçaria
  todo mundo a aceitar de novo. O dono decide se prefere versionar.)**
- O log pode conter caminhos do Windows com o nome do usuário do PC. Por isso ele é mostrado inteiro em "ver" e tem
  chave para não ir.

### App (desktop)

- `features/feedback/` no padrão de `whatsnew/` (componente, store, lógica pura testada, strings, CSS module),
  carregado sob demanda.
- Três pontes novas em `window.alga.app`: ler o fim do log, capturar a janela, pegar (e consumir) o marcador de
  travamento, no padrão de `takeSetupEco`.
- O marcador é escrito no processo principal (`main/feedback.ts`): `render-process-gone` com motivo de falha marca;
  a janela sem responder (`unresponsive`) também marca e `responsive` desmarca.
- Rascunho (tipo e texto) em `localStorage`, por conta.

## O que fica com quem constrói

- Nomes de arquivos, de colunas e das pontes; forma exata do multipart.
- Posição e empilhamento do cartão em relação ao dock da chamada e aos toasts em janelas pequenas.
- Curvas e tempos finos, dentro do descrito em "Vida".
- Onde o marcador de travamento mora no disco e quais motivos de `render-process-gone` contam (saída limpa e
  encerramento pelo usuário não contam).
- Como separar o log da sessão que caiu do log da sessão nova (a linha `start v…` do `log.ts` marca a fronteira).
- A oferta de travamento só existe com sessão aberta (o shell montado); na tela de login nada aparece.
- Som: nenhum **(decisão do desenho)**.
- Se a exportação de dados inclui o arquivo do print ou só a indicação dele, seguindo o que ela já faz com arquivos.

## Como saber que ficou pronto

- Testes: contrato em `packages/shared`, rotas em `apps/server/test` (também em PostgreSQL real), lógica do desktop
  (rascunho, o que vai junto por tipo, regra da oferta de travamento).
- Ponta a ponta no app real, no molde de `apps/desktop/scripts/whatsnew-e2e.mjs`, com capturas em
  `docs/screenshots/feedback/`: cada tipo, com print, "ver o que vai junto", enviado, falha de rede, vazio, "Seus
  envios", oferta depois de travamento, movimento reduzido, cartão aberto durante uma chamada.
- `docs/design/design-system.md` ganha a seção do feedback; `docs/STATE.md` registra a entrega.
- O dono abre, conta um bug com print em menos de 15 segundos e acha gostoso de usar.
