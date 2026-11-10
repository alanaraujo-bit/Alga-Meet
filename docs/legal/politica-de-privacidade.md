> **RASCUNHO — requer revisão de advogado antes de publicação**
>
> Versão de rascunho 0.1 · 2026-11-01 · Brasil. `[PREENCHER: …]` = dado da empresa ou de configuração ainda não
> definido. `[LACUNA]` = o produto ainda não faz o que o texto descreve. Não publique antes de resolver, ou reescreva o
> trecho. Este texto descreve o código em `apps/server` e `apps/desktop` na data acima. Se o código mudar, esta
> política muda junto. Pendências: `docs/legal/review-notes.md`.

# Política de Privacidade do Alga Meet

Última atualização: `[PREENCHER: data de publicação]`

## Em resumo

- Coletamos o necessário para o Alga Meet funcionar:
  - sua conta;
  - o que você envia (mensagens e arquivos);
  - dados técnicos de acesso.
- **Não vendemos dados, não mostramos anúncios e não temos rastreadores no app.** O único diagnóstico enviado é o relatório opcional de qualidade de chamada, desligado por padrão (ver abaixo).
- Mensagens e chamadas são cifradas no caminho, mas **não têm criptografia de ponta a ponta**. Nossos servidores
  conseguem acessar o conteúdo, e a equipe só o acessa nos casos da seção 5.
- Parte dos dados fica em servidores nos **Estados Unidos**. Os servidores de voz e de transmissão de tela ficam em
  **São Paulo**.
- Você pode ver, corrigir e apagar seus dados. Algumas ferramentas para isso ainda estão sendo construídas, e
  indicamos quais são na seção 7.

## 1. Quem cuida dos seus dados

| | |
|---|---|
| Controlador | `[PREENCHER: razão social]`, CNPJ `[PREENCHER]`, `[PREENCHER: endereço]` |
| Encarregado (DPO) | `[PREENCHER: nome completo]`, `[PREENCHER: privacidade@dominio]` |

O encarregado é a pessoa que responde por nós em assuntos de dados pessoais. Fale com ele para exercer seus direitos,
tirar dúvidas ou reclamar. A ANPD também usa esse contato para falar com a gente.

## 2. Que dados tratamos, para quê e por quanto tempo

Os incisos citados são do art. 7º da LGPD. As bases legais usadas são:

- **contrato**: o necessário para prestar o serviço que você contratou ao criar a conta (inciso V);
- **obrigação legal** (inciso II);
- **legítimo interesse**: segurança e prevenção de abuso, sempre equilibradas com os seus direitos (inciso IX);
- **exercício de direitos**: defesa em processos (inciso VI).

| Dado | Para quê | Base legal | Por quanto tempo | Com quem compartilhamos |
|---|---|---|---|---|
| **Cadastro**: e-mail, nome de usuário, nome de exibição, senha (só guardamos um *hash* argon2id, nunca a senha), data de criação, se o e-mail foi confirmado | Criar e manter a conta, entrar, recuperar a senha, avisos do serviço, conter contas falsas | Contrato | Enquanto a conta existir (seção 8) | Hospedagem (Railway). O e-mail vai ao provedor de e-mail (Resend) e, quando você compra algo, ao Mercado Pago |
| **Data de nascimento** `[LACUNA: ainda não coletada]` | Cumprir a idade mínima e as proteções para adolescentes (Lei 15.211/2025) | Obrigação legal `[confirmar]` | Enquanto a conta existir. Usada só para aferir idade (Lei 15.211/2025, art. 13) | Hospedagem |
| **Perfil**: avatar, cor de destaque, bio, status escolhido (disponível, ausente, não perturbe, invisível) | Mostrar quem você é para outras pessoas | Contrato | Até você mudar ou remover. O arquivo antigo do avatar é apagado | Hospedagem. O avatar fica num endereço público (seção 6) |
| **Códigos enviados por e-mail** (confirmação e redefinição de senha) | Provar que o e-mail é seu | Contrato | Guardamos só um *hash*. Vale 24 h (confirmação) ou 1 h (senha) e é apagado quando usado | Hospedagem e Resend (o e-mail com o link) |
| **Sessões**: *hash* do token de login, identificação do app e do sistema (*user agent*), quando entrou e quando usou por último. **Sem endereço IP** | Manter você conectado, listar e encerrar sessões, segurança | Contrato e legítimo interesse | A sessão expira após 30 dias sem uso ou 90 dias depois do login. Sair da conta apaga a sessão `[LACUNA: sessões vencidas e não reabertas ainda não são apagadas automaticamente]` | Hospedagem |
| **Relacionamentos**: amigos, pedidos de amizade, bloqueios | Amizades, DMs, bloquear quem você não quer | Contrato | Até você desfazer ou excluir a conta | Hospedagem |
| **Espaços**: espaços que você criou ou de que participa, cargos, apelidos, convites criados por você, banimentos (com motivo e moderador), silenciamento aplicado por moderador | Funcionamento e moderação dos espaços | Contrato. Banimentos: legítimo interesse (segurança da comunidade) | Enquanto você for membro, o espaço existir ou o banimento valer | Hospedagem. Membros do espaço veem parte disso (seção 6) |
| **Mensagens**: texto, respostas, edições, reações, menções, o que você já leu, data e hora | Entregar e mostrar as conversas | Contrato | Até você, um moderador ou o dono do espaço apagar, ou até o canal ou espaço ser excluído. Cópias de backup duram até `[PREENCHER: 3 meses]` | Hospedagem. Visíveis para quem participa do canal ou da DM |
| **Arquivos enviados**: o arquivo, nome (limpo de caracteres perigosos), tipo, tamanho e dimensões | Entregar e mostrar os anexos | Contrato | Apagado do armazenamento cerca de 1 minuto depois de a mensagem ser apagada. O armazenamento de arquivos não tem backup | Hospedagem (armazenamento de arquivos) |
| **Voz, câmera e transmissão de tela** (em tempo real) | Fazer a chamada ou a transmissão chegar às outras pessoas | Contrato | **Não gravamos.** A mídia só passa pelo servidor de mídia. Quem está em qual canal (e se está mudo, ensurdecido ou transmitindo) fica só na memória e some quando você sai | Servidor de mídia em São Paulo (Vultr). Participantes da chamada |
| **Dados da transmissão**: resolução, quadros por segundo e taxa de bits que o app informa | Aplicar o limite de qualidade do seu plano | Contrato | Usados na hora, não guardados | — |
| **Presença e "digitando…"** | Mostrar quem está online e quem está escrevendo | Contrato | Só na memória, em tempo real | Amigos e membros dos seus espaços |
| **Pagamentos**: produto, valor, status, período, identificadores do Mercado Pago, histórico de notificações de pagamento (guardamos o identificador e um *hash* do conteúdo). **Nunca dados de cartão** | Cobrar, liberar benefícios, reembolsar, contabilidade e impostos | Contrato e obrigação legal (fiscal) | Pelo prazo fiscal e contábil, `[PREENCHER: em geral 5 anos; confirmar com o contador]`. Se você excluir a conta, esses registros são separados da sua identidade sempre que a lei permitir | Mercado Pago (seção 4) |
| **Registros técnicos do servidor**: endereço IP, data e hora, tipo e endereço da requisição, resultado. Códigos de convite e assinaturas de links são apagados do registro. **Sem conteúdo** | Segurança, limites contra abuso, diagnóstico de falhas | Legítimo interesse | `[PREENCHER: prazo de retenção de logs do provedor]` | Hospedagem |
| **Registros de acesso** (Marco Civil): data, hora e IP de cada uso, ligados à conta `[LACUNA: ainda não implementado]` | Cumprir o art. 15 do Marco Civil | Obrigação legal | **6 meses**, sob sigilo. Depois são apagados | Só por ordem judicial (seção 11) |
| **Denúncias e moderação**: conteúdo denunciado, quem denunciou, decisão e recurso `[LACUNA: fluxo de denúncia ainda não existe]` | Analisar denúncias, proteger pessoas, cumprir o ECA Digital | Legítimo interesse, obrigação legal (Lei 15.211/2025, arts. 27 a 30) e exercício de direitos | `[PREENCHER: 6 meses após o fim do caso]`. Mais tempo quando houver indício de crime ou ordem judicial | Autoridades, nos casos de exploração de menores (seção 10) |
| **Atendimento**: mensagens que você nos envia | Responder e resolver o seu pedido | Contrato e obrigação legal (CDC) | `[PREENCHER]` | `[PREENCHER: ferramenta de e-mail usada]` |
| **Feedback enviado pelo app** ("Enviar feedback"): o tipo (bug, travamento, ideia ou elogio), o que você escreveu, a versão do app e do Windows, onde você estava no app (início, conversa ou espaço; se em chamada, transmitindo ou no Cinema; **sem nomes** de espaços, canais ou pessoas). Só em bug e travamento, e só se você deixar: o fim do registro técnico do app (até 200 linhas; pode mostrar pastas do seu computador). Só se você incluir: um print, guardado sem metadados. Tudo aparece para você antes do envio | Corrigir problemas e decidir melhorias | Legítimo interesse (você inicia o envio e vê o que vai junto) | Enquanto a conta existir; apagado junto com ela, inclusive o print. Entra na cópia dos seus dados | Hospedagem (o print fica no armazenamento de arquivos). Só a equipe lê |

## 3. O que não fazemos

- **Não vendemos nem alugamos dados**, para ninguém.
- **Não temos anúncios** e não montamos perfil de você para publicidade.
- **Não há analytics nem rastreamento no app.** Nenhum SDK de rastreamento, nenhum pixel e nenhum relatório de uso é
  enviado. Também não coletamos conteúdo de mensagens para métricas.
- **Relatório de qualidade de chamada — opcional, desligado por padrão.** Só se você ativar em Configurações, ao fim de
  cada chamada o app envia números agregados para melhorarmos a voz e a transmissão: duração, tempo para entrar,
  reconexões, latência, jitter, perda de pacotes, codecs usados, se a codificação foi por hardware, faixas de fps e
  resolução, versão do app e do Windows e a classe do processador/placa de vídeo. **Nunca** inclui áudio, vídeo, mensagens,
  nomes de salas, quem estava na chamada nem seu IP. Seu identificador é guardado como hash com sal rotativo e os dados
  são apagados em 30 dias. Base legal: consentimento (LGPD art. 7º, I), revogável a qualquer momento desligando a opção.
- **Não enviamos relatórios de travamento.** O app guarda esses relatórios só no seu computador.
- **Não gravamos chamadas nem transmissões.**
- **Não analisamos sua voz** para identificar você. Não tratamos biometria.
- **Não pedimos sua localização.** Também apagamos a localização GPS das fotos comuns que você envia. A exceção são
  alguns formatos, explicados na seção 5.
- **Não lemos o que você digita fora do app.** Os atalhos globais funcionam como explicado na seção 9.
- **Não recebemos dados de cartão.** Eles ficam com o Mercado Pago.
- **Não usamos seu conteúdo para treinar inteligência artificial.**

## 4. Onde os dados ficam e com quem compartilhamos

| Empresa | Onde | Papel | O que recebe |
|---|---|---|---|
| Railway (Railway Corporation) | **EUA**, região US East (Virgínia) | Operador: hospeda o servidor do Alga Meet, o banco de dados, os arquivos e os registros técnicos | Quase tudo da seção 2 |
| Vultr (`[confirmar razão social]`) | Servidor em **São Paulo** (empresa dos EUA) | Operador: servidor de mídia que encaminha voz, câmera e tela. O software é o LiveKit, de código aberto, rodando num servidor nosso: a empresa LiveKit **não** recebe seus dados | Mídia em tempo real, seu IP e o identificador da sua conta na sala |
| Resend | **EUA**. Usa a Amazon SES, região de envio `[PREENCHER]` | Operador: envia e-mails de confirmação e de senha | Seu e-mail e o conteúdo da mensagem (link ou código) |
| Mercado Pago | Brasil | **Controlador independente** dos dados de pagamento, com política própria | O e-mail da sua conta, o produto e o valor. Os dados que você digita na página do Mercado Pago vão só para ele |
| GitHub (Microsoft) | EUA | Distribui as atualizações do app | Seu IP e a versão do app, quando o app procura ou baixa uma atualização |

Também compartilhamos dados com autoridades públicas, mas só nos casos da seção 11.

### 4.1 Transferência internacional

Enviar dados para os EUA é uma transferência internacional (LGPD, art. 33). Para proteger esses dados, usamos as
**cláusulas-padrão contratuais da ANPD** (Resolução CD/ANPD nº 19/2024), incorporadas aos contratos com os
fornecedores acima. `[LACUNA: as cláusulas-padrão ainda não foram assinadas com Railway, Resend e GitHub]`

Você pode pedir uma cópia dessas cláusulas ao encarregado.

## 5. Como protegemos os dados

Descrevemos só o que já está implementado. **Não prometemos mais do que isso.**

### Transporte

- **App e servidor:** HTTPS e WSS (TLS).
- **Voz, câmera e tela:** cifradas com DTLS-SRTP entre o seu app e o servidor de mídia. Esse servidor decifra a mídia
  para encaminhá-la, então **ele pode acessar o conteúdo**.

### Sem criptografia de ponta a ponta

Ela ainda não existe no Alga Meet, nem nas chamadas nem nas mensagens. Nossos sistemas conseguem ler as mensagens
guardadas e a mídia que passa pelo servidor.

A equipe só acessa conteúdo em três casos:

- para analisar uma denúncia;
- para cumprir uma ordem judicial;
- para investigar abuso ou um incidente de segurança.

`[LACUNA: o acesso da equipe ainda não fica registrado num histórico de auditoria]`

A criptografia de ponta a ponta está no nosso planejamento. Quando ela existir, esta política será atualizada.

### Dados guardados

- Não afirmamos aqui que o banco de dados é cifrado em disco: ainda não confirmamos essa configuração no provedor.
  `[PREENCHER: confirmar com a Railway]`
- **Backups do banco de dados:** `[PREENCHER: confirmar a configuração; a proposta é diário, semanal e mensal, com no
  máximo 3 meses]`.

### Senhas e login

- As senhas são guardadas com argon2id. Senhas comuns ou fracas são recusadas.
- Tentativas de login têm limite por IP e por conta.
- O token de login é aleatório (256 bits), e o servidor guarda só o *hash* dele.
- As sessões expiram.
- Trocar a senha encerra as outras sessões.

### No seu computador

O token de login fica cifrado pelo Windows (DPAPI).

### Arquivos

- O tipo do arquivo é conferido pelo conteúdo, e não pelo nome.
- **Imagens:** fotos e imagens PNG, JPEG, WebP, GIF e AVIF são recodificadas antes de serem guardadas. Elas perdem
  metadados como GPS, modelo da câmera, XMP e IPTC.
- **Atenção: HEIC, TIFF, BMP e RAW não são recodificados.** Os metadados desses formatos, **inclusive a localização**,
  chegam a quem baixar o arquivo.
- **Links de download:** são assinados, valem cerca de 1 hora e conferem se a pessoa ainda tem acesso ao canal.
- **Downloads forçados:** HTML, SVG, PDF e executáveis nunca abrem dentro do app, só podem ser baixados.
- **Antivírus:** **os arquivos não passam por antivírus.**

### App

- A interface roda isolada do sistema (*sandbox*), com política de conteúdo restritiva.
- **A tela só é capturada depois que você escolhe a tela ou janela no seletor.**

### Registros técnicos

Os registros não guardam senhas, tokens, o corpo das requisições nem códigos de convite.

### Revisões

O servidor passou por uma revisão de segurança em 2026-11-01. As falhas encontradas foram corrigidas, quase todas com
testes automáticos.

### Incidentes

Se um incidente de segurança puder causar risco ou dano relevante a você, avisaremos você e a ANPD (LGPD, art. 48).

## 6. O que outras pessoas veem

- **Qualquer pessoa no Alga Meet:**
  - nome de usuário, nome de exibição, avatar, bio e cor de destaque;
  - o arquivo do avatar fica num endereço público, que qualquer pessoa com o link pode abrir.
- **Prévia de convite**, que qualquer pessoa com o link pode abrir:
  - nome e ícone do espaço;
  - número de membros;
  - o identificador de quem criou o convite.
- **Amigos e membros dos seus espaços:**
  - se você está online, ausente ou em "não perturbe". No modo "invisível", você aparece offline;
  - mesmo invisível, "digitando…" e a sua presença num canal de voz ainda mostram que você está ativo.
- **Membros de um espaço:**
  - seu apelido e seus cargos;
  - em que canal de voz você está e se está mudo, ensurdecido ou transmitindo;
  - as mensagens nos canais que eles podem ver.
- **Dono e moderadores do espaço:** podem apagar mensagens e silenciar, expulsar ou banir membros.
- **Participantes de uma DM:** veem as mensagens da DM.

## 7. Seus direitos e como exercê-los

Você tem os direitos do art. 18 da LGPD. Para exercê-los:

- **Como pedir:** escreva ao encarregado (seção 1) do e-mail da sua conta. Se for preciso, confirmaremos que você é o
  dono da conta. **Nunca pedimos a sua senha.**
- **Custo:** o pedido é gratuito.
- **Prazo de confirmação e acesso:** em formato simples, na hora; ou numa declaração completa, em até **15 dias**
  (LGPD, art. 19).

| Direito | Como fazer | Hoje |
|---|---|---|
| Saber se tratamos seus dados e acessá-los (art. 18, I e II) | No app você vê perfil, sessões abertas, amigos, espaços e mensagens. Para uma cópia completa, peça ao encarregado | Parcial. `[LACUNA: exportação de dados]` |
| Corrigir dados (III) | No app: nome de exibição, nome de usuário, bio, avatar, cor e status | Existe. `[LACUNA: trocar e-mail]`. Até lá, peça ao encarregado |
| Anonimizar, bloquear ou eliminar dados desnecessários ou tratados em desacordo com a lei (IV) | Pedido ao encarregado | Manual |
| Portabilidade (V) | Arquivo em formato legível por máquina (JSON) com seus dados e mensagens | `[LACUNA: exportação de dados]` |
| Eliminar dados (VI) e excluir a conta (Marco Civil, art. 7º, X) | No app você já apaga mensagens, sai de espaços, exclui espaços próprios e remove o avatar. Excluir a conta: seção 8 | `[LACUNA: exclusão de conta]`. Até lá, peça ao encarregado |
| Saber com quem compartilhamos (VII) | Seção 4 | Existe |
| Consentimento (VIII e IX) | Hoje não usamos consentimento como base legal. Se um dia pedirmos (por exemplo, para e-mails de novidades), você poderá recusar ou revogar sem perder nada do serviço | Não se aplica |
| Opor-se a um tratamento (art. 18, §2º) | Pedido ao encarregado | Manual |
| Revisão de decisão automatizada (art. 20) | Não tomamos decisões automatizadas que avaliem o seu perfil. Limites automáticos (anti-spam, teto de qualidade do plano) podem ser contestados no atendimento | — |
| Encerrar sessões e bloquear pessoas | No app | Existe |
| Reclamar à ANPD (art. 18, §1º) | gov.br/anpd | — |

## 8. Exclusão da conta e retenção

`[LACUNA: a exclusão de conta não existe no produto. Este é o comportamento a implementar. Decisões abertas em
review-notes D13 e D14]`

Quando você excluir a conta:

- **Apagamos** em até `[PREENCHER: 30 dias]`: e-mail, nome de usuário, perfil, avatar, sessões, amizades, bloqueios e
  participação em espaços.
- **Espaços de que você é dono** são excluídos junto, com as mensagens e os arquivos deles. Avisamos isso antes de
  você confirmar. `[LACUNA: ainda não é possível transferir a posse de um espaço]`
- **Suas mensagens em espaços e DMs:** `[DECISÃO D13: apagar ou manter como "Usuário excluído"; a proposta é deixar
  você escolher na hora da exclusão]`
- **Guardamos só o que a lei exige ou permite (LGPD, art. 16):**
  - registros de pagamento, pelo prazo fiscal e separados da sua identidade sempre que possível;
  - registros de acesso, por 6 meses (Marco Civil);
  - casos de moderação com indício de crime, pelo prazo legal.
- **Backups:** as cópias de segurança são substituídas no ciclo normal, em até `[PREENCHER: 3 meses]`.

**Contas com e-mail não confirmado:** a proposta é apagá-las depois de `[PREENCHER: 30 dias]`. `[LACUNA: hoje elas
nunca são apagadas]`

## 9. Dados no seu computador (app para Windows)

O app **não usa cookies de rastreamento nem de publicidade**. O login é feito por um token, e não por cookies. O que
fica no seu computador:

| O quê | Onde | Para quê | Sai do computador? |
|---|---|---|---|
| Token de login | Arquivo `session.bin` na pasta de dados do app, cifrado pelo Windows (DPAPI) | Manter você conectado | Só vai para o nosso servidor, para provar que é você |
| Preferências de áudio e vídeo: microfone e alto-falante escolhidos, modo de entrada, sensibilidade, volume de cada pessoa, qualidade e codec da transmissão, sons | Armazenamento local do app (`localStorage`) | Lembrar suas escolhas | Não |
| Atalhos globais configurados | Armazenamento local do app | Lembrar seus atalhos | Não |
| Registro técnico do app (`logs/main.log`, até 1 MB, com mais 3 arquivos antigos) | Pasta de dados do app | Entender erros. Não guarda conteúdo de mensagens nem tokens | Só se você enviar um feedback de bug ou travamento com o registro ligado: vão as últimas linhas (até 200), que o app mostra antes |
| Rascunho do feedback (tipo e texto) | Armazenamento local do app | Não perder o que você escrevia | Só quando você envia |
| Aviso de que o app travou (`crash-marker.json`: quando e em qual versão) | Pasta de dados do app | Perguntar, na próxima abertura, se você quer contar o que aconteceu. Apagado ao ser lido | Não. Se você enviar o feedback, vai só o tipo de falha |
| Relatórios de travamento | Pasta de dados do app | Diagnóstico. Podem conter trechos da memória do app | Não: o envio automático está desligado |
| Cache de imagens e arquivos | Pasta de dados do app | Carregar mais rápido | Não |

**Atalhos globais (por exemplo, apertar para falar):**

- Quando você configura um atalho, o app passa a observar o teclado e o mouse em todo o Windows. Assim o atalho
  funciona até dentro de um jogo.
- A comparação com o seu atalho é feita no próprio computador. O app **não grava, não guarda e não envia** o que você
  digita.
- O monitoramento só fica ligado enquanto houver algum atalho configurado.

**Microfone:**

- A redução de ruído roda no seu computador.
- O áudio do microfone só é enviado enquanto você está num canal de voz.
- Quando você fica mudo, o áudio não é transmitido para as outras pessoas. O Windows pode continuar mostrando que o
  microfone está em uso.

**Atualizações:** o app consulta o GitHub para saber se há uma versão nova (seção 4).

## 10. Crianças e adolescentes

- **Idade mínima:** o Alga Meet é para pessoas com **16 anos ou mais** (Termos, seção 3).
- **Contas de menores de 16:** se soubermos que uma conta pertence a alguém com menos de 16 anos, ela é suspensa e os
  dados são apagados. Guardamos só o que a lei exigir.
- **Contas de 16 e 17 anos:**
  - começam com as configurações mais protetivas disponíveis (Lei 15.211/2025, art. 7º). `[LACUNA]`
  - tratamos esses dados no melhor interesse do adolescente (LGPD, art. 14).
- **Publicidade:** não fazemos perfilamento para publicidade de ninguém, e muito menos de adolescentes.
- **Data de nascimento:** usada **só** para aferir a idade (Lei 15.211/2025, art. 13).
- **Exploração e abuso:** conteúdo com aparência de exploração ou abuso sexual, sequestro ou aliciamento de menores é
  removido e comunicado às autoridades. Guardamos os dados relacionados pelo prazo legal (Lei 15.211/2025, art. 27).
- **Contato de pais e responsáveis:** pelo e-mail `[PREENCHER: denuncias@dominio]` ou pelo encarregado.

## 11. Registros de acesso e autoridades

- **Registros de acesso:** o Marco Civil da Internet (art. 15) nos obriga a guardar, por **6 meses**, a data, a hora
  e o IP de cada uso do Alga Meet. Esses registros ficam sob sigilo, em ambiente controlado.
  `[LACUNA: ainda não implementado]`
- **Ordem judicial:** só entregamos esses registros e o conteúdo de comunicações com **ordem judicial**.
- **Dados cadastrais:** autoridades com competência legal podem requisitá-los, na forma da lei (Marco Civil, art. 10,
  §3º).
- **Pedidos sem base legal:** recusamos.
- **Pedido para guardar por mais tempo:** a polícia, uma autoridade administrativa ou o Ministério Público podem pedir
  que guardemos os registros por mais tempo (art. 15, §2º).

## 12. Mudanças nesta política

- Quando mudarmos algo importante, avisaremos no app e por e-mail **antes** de a mudança valer. O aviso terá um resumo
  do que mudou.
- As versões anteriores ficam disponíveis em `[PREENCHER: endereço]`.

## 13. Contato

- **Encarregado:** `[PREENCHER: nome]`, `[PREENCHER: privacidade@dominio]`
- **Endereço:** `[PREENCHER]`
- **Autoridade Nacional de Proteção de Dados:** https://www.gov.br/anpd
