# 0003 — Distribuição, assinatura de código e atualizações

- Status: **aceita** (2026-11-01). A assinatura de código depende de uma ação humana (ver "Bloqueios").
- Escopo: `apps/desktop/electron-builder.yml`, `apps/desktop/build/installer.nsh`, `apps/desktop/src/main/updater.ts`, `src/main/deep-link*.ts`, `src/main/secure-store.ts`

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Instalador | NSIS **assistido** (`oneClick: false`), **por usuário** em `%LOCALAPPDATA%\Programs\Alga Meet`, sem UAC. A página "todos os usuários / só eu" é pulada (`customInstallMode`). | Instala sem admin, igual ao Discord. O usuário ainda pode escolher a pasta. |
| Idioma | Instalador só em pt-BR (`installerLanguages: [pt_BR]`). | Com `multiLanguageInstaller: false` o electron-builder força `en_US`. Por isso usamos um único idioma empacotado. |
| Atalhos | Área de trabalho e Menu Iniciar. O AppUserModelID `com.alga.meet` vale para o atalho e para `app.setAppUserModelId`. | Sem isso os toasts do Windows não aparecem e a barra de tarefas agrupa errado. |
| Desinstalação | Pergunta (MessageBox pt-BR, **padrão = Não**) se também deve apagar `%APPDATA%\Alga Meet`. Em modo silencioso (`/S`) e em updates (`--updated`) os dados são sempre mantidos. Também remove a entrada "Iniciar com o Windows" (`HKCU\…\Run\com.alga.meet`). | Apagar dados pessoais exige um sim explícito. |
| Artefato | `AlgaMeet-Setup-${version}.exe` + `.blockmap` + `latest.yml` | O blockmap permite update diferencial (baixa só os blocos que mudaram). |
| Binário do Electron | `electronDist: ../../node_modules/electron/dist` + `electronVersion: 45.2.1` | Com npm workspaces o Electron fica no `node_modules` da raiz, e o electron-builder não consegue ler a versão de lá. Empacotamos exatamente o binário testado, sem download. **Ao atualizar o Electron, atualize `electronVersion`.** |
| Nativo | `uiohook-napi` é N-API com prebuilds: `npmRebuild: false`. O `.node` vai em `app.asar.unpacked`. Os prebuilds de macOS/Linux ficam de fora. | Não depende de toolchain C++ na máquina de build. |
| Updates | `electron-updater`, provider GitHub (`alanaraujo-bit/alga-meet`). Verifica ao abrir e a cada 4 h, só na versão instalada. Baixa em segundo plano e instala ao sair ou em `updates.install()` (`quitAndInstall(silent, relaunch)`). | Erros (offline, 404) viram `{ state: 'error', message }` e são logados numa linha só. O app nunca cai por isso. |

## Medições (Windows 11 Pro 10.0.26300, 2026-11-01, build local sem assinatura)

| Item | Valor |
|---|---|
| `AlgaMeet-Setup-0.1.0.exe` | **114.523.149 bytes (109,2 MiB)** |
| Instalado (`win-unpacked`) | 314,5 MiB. `Alga Meet.exe` sozinho tem 238,3 MiB (Chromium/Electron); `dxcompiler.dll` tem 24,6 MiB. Os locales foram reduzidos a pt-BR + en-US. |
| `app.asar` | 3,0 MiB (main/preload/renderer + electron-updater + uiohook-napi) |
| Build do instalador (`electron-builder`, após `electron-vite build`) | ~20 s |
| Instalação silenciosa (`/S /D=%TEMP%\alga-install-test`) | **7,8 s**, exit 0 (execuções anteriores: 7,6–7,7 s) |
| App instalado aberto (perfil isolado) | vivo após 8 s. O updater consultou o GitHub, recebeu **404** (repo ainda não existe), logou `WARN updater error: 404` e seguiu rodando. |
| Desinstalação silenciosa (`Uninstall Alga Meet.exe /S`) | **6,2 s**, exit 0 (anteriores: 6,2–6,3 s). Pasta, atalhos e chave `HKCU\…\Uninstall` removidos. `%APPDATA%\Alga Meet` preservado. |
| Desinstalação interativa | O MessageBox pt-BR aparece com "Não" como botão padrão. Enter mantém os dados. Capturas em `docs/screenshots/2026-11-01-installer-welcome.png` e `2026-11-01-uninstall-data-prompt.png`. |

Scripts de verificação usados: `scripts/verify-native.mjs` (app construído) e os testes de instalação descritos acima (PowerShell, pasta temporária, nada fica instalado).

## Assinatura de código (bloqueio humano)

**Estado atual:** builds **não assinados**. O electron-builder registra `no code signing certificate configured, signing is skipped`.

**Como ligar, sem mudar código:**
- **Certificado PFX (OV/EV) via signtool.** Exporte `CSC_LINK` (caminho/URL/base64 do `.pfx`) e `CSC_KEY_PASSWORD` antes de `npm run dist`. O electron-builder assina automaticamente: `Alga Meet.exe`, o desinstalador, `elevate.exe` e o setup. Usa SHA-256 com timestamp. Se as variáveis não existirem, o build sai sem assinatura, como hoje.
- **Azure Trusted Signing.**
  1. Crie a conta e o perfil de certificado no Azure. A elegibilidade para PJ/PF no Brasil **precisa ser confirmada**.
  2. Exporte `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`.
  3. Descomente o bloco `win.azureSignOptions` em `electron-builder.yml`, ou passe os mesmos campos na linha de comando:
     `npx electron-builder --win --publish never -c.win.azureSignOptions.endpoint=https://<região>.codesigning.azure.net -c.win.azureSignOptions.codeSigningAccountName=<conta> -c.win.azureSignOptions.certificateProfileName=<perfil> -c.win.azureSignOptions.publisherName="<CN>"`
  
  O electron-builder instala o módulo PowerShell `TrustedSigning` e assina. O bloco fica comentado porque, se estiver presente, o build exige credenciais e quebraria os builds locais sem elas.

**Impacto no SmartScreen e no usuário:**
- **Sem assinatura (hoje).** Ao abrir o instalador baixado, o Windows mostra "O Windows protegeu o computador" com editor desconhecido. O usuário precisa clicar em *Mais informações → Executar assim mesmo*. Antivírus também tendem a ser mais desconfiados com binários Electron sem assinatura.
- **Com assinatura.** A reputação no SmartScreen fica ligada à identidade do certificado e cresce com downloads. Segundo a Microsoft (2024), certificados EV **não** dão mais reputação imediata. OV ou Trusted Signing são o caminho econômico, mas os primeiros downloads ainda podem ver o aviso.
- **Updates.** O `electron-updater` só confere a assinatura do update quando o `app-update.yml` traz `publisherName`. O electron-builder preenche esse campo a partir do certificado.
  - Hoje, sem assinatura, nada é conferido.
  - A transição de não assinado para assinado funciona.
  - Depois que assinarmos, **todo** release precisa ser assinado pelo mesmo publisher, ou os clientes recusam o update.

## Canal de releases (bloqueio humano)

O repositório `alanaraujo-bit/alga-meet` ainda não existe. Por isso hoje o app instalado recebe 404 (medido) e mostra "Nenhuma versão publicada ainda."

Ponto importante: **releases de repositório privado exigem token embutido no app** (`GH_TOKEN` no `app-update.yml`). Isso é inaceitável. Opções:
- o repositório ser público; ou
- um repositório **público só de releases** (por exemplo `alga-meet-releases`), mudando `publish.repo`; ou
- um provider `generic` (CDN/S3) mais tarde.

Publicar: `GH_TOKEN=… npx electron-builder --win --publish always` (dentro de `apps/desktop`, após `electron-vite build`). Isso cria um **draft**. O release só vale para os clientes quando for publicado no GitHub.

## Rollout gradual e rollback

1. **Rollout em estágios.** Cada instalação gera um *staging user ID* estável. O log do app instalado mostrou `Generated new staging user ID`. Fluxo:
   1. Publique o release.
   2. Edite o `latest.yml` do release e adicione `stagingPercentage: 10`.
   3. Observe logs e relatos.
   4. Suba para 50 e depois para 100. O `electron-updater` só oferece a versão às instalações dentro da porcentagem.
2. **Parar um release ruim.** Ponha `stagingPercentage: 0` no `latest.yml` desse release. Ninguém novo recebe a versão. Quem já recebeu continua nela.
3. **Rollback = "roll forward".** Publique `X+1`: um revert da mudança ruim, com versão maior. **Downgrade automático está desligado** (`allowDowngrade = false`), porque voltar para um binário antigo sobre dados ou formato mais novos é arriscado e difícil de testar.
4. **Manter releases anteriores.** Nunca apague releases antigos do GitHub. O instalador da versão anterior continua disponível para reinstalação manual, em suporte caso a caso. O `settings.json` é tolerante (campos desconhecidos ou inválidos voltam ao padrão), então um downgrade manual não quebra a inicialização.
5. **Política de downgrade.** Sem downgrade automático. Um downgrade manual é permitido, mas sem garantia de compatibilidade de dados.

## Outros pontos observados

- Em dev, apareceu o prompt do **Firewall do Windows** para `electron.exe` ("Deseja permitir que redes públicas e privadas acessem este aplicativo?"). A causa provável são os sockets UDP do WebRTC. O mesmo deve acontecer com `Alga Meet.exe` na primeira chamada. Um instalador por usuário não pode criar regra de firewall (exige admin). Se medirmos que a mídia funciona com "Cancelar" (só UDP de saída), documentar para o suporte.
- `default_app.asar` (108 KB) vai junto porque usamos `electronDist`. Ele é inerte quando existe `app.asar`.

## Deep links `algameet://` (2026-11-01)

### Links aceitos

O parser (`src/main/deep-link-logic.ts`) é uma **allowlist**: duas regex aplicadas à string crua, sem `new URL()` e sem normalização. Tudo o que não casar exatamente é descartado.

| Link | Origem | Chega ao renderer como |
|---|---|---|
| `algameet://auth/verify-email?token=<t>` | e-mail de verificação (`Mailer.link` com `EMAIL_LINK_URL=algameet://auth`) | `{ kind: 'verify-email', token }` |
| `algameet://auth/reset-password?token=<t>` | e-mail de redefinição de senha | `{ kind: 'password-reset', token }` |
| `algameet://invite/<code>` | convite | `{ kind: 'invite', code }` |

- `token`: `[A-Za-z0-9_-]{16,128}`. O servidor gera 43 caracteres (32 bytes em base64url) e recusa mais de 128.
- `code`: `[0-9A-Za-z]{1,32}`, a mesma regra do `codeParam` do servidor (ele emite 8).
- O link inteiro tem no máximo 512 caracteres. Uma barra final é tolerada, porque alguns launchers do Windows a acrescentam.
- **Recusados**: host ou caminho desconhecido, parâmetro extra ou fora de ordem, `#`, escapes `%`, `+`, `..`, maiúsculas, usuário/senha/porta, quebra de linha. O log registra só `deep link rejected algameet://<host> (<n> chars)`, sem caminho nem query.
- **Segredos fora do log.** Token e código são credenciais de portador. O log de início (`argv`) também passa pela redação, e um link aceito é logado só pelo `kind`. O `verify-native` confere que nem o token nem o código aparecem no `main.log`.

### Entrega ao renderer (`window.alga.deepLinks`)

```ts
type DeepLink = { kind: 'verify-email'; token: string } | { kind: 'password-reset'; token: string } | { kind: 'invite'; code: string }
deepLinks: { onLink(cb: (l: DeepLink) => void): Unsubscribe; takePending(): Promise<DeepLink | null> }
```

- **Partida a frio** (link no `argv` do primeiro processo): o main guarda o link. A janela abre mesmo com `--hidden`, porque um clique em link sempre mostra o app.
- **App já aberto**: o Windows inicia um segundo processo com o link; o `second-instance` recebe o `argv` dele, valida o link, restaura e foca a janela.
- **Ordem no renderer**: primeiro assinar `onLink`, depois chamar `takePending()` uma vez. Até essa chamada o main segura o link mais recente. Depois dela, empurra cada link por `onLink`. Um reload ou crash da página volta a segurar até a nova página chamar `takePending()`.
- **O renderer trata o link como entrada não confiável.** O token só vai no corpo do POST para a API, nunca numa URL ou em HTML. Para um convite, mostrar a prévia (`GET /invites/:code`) antes de entrar.

### Registro do protocolo

- **App instalado (NSIS).** O electron-builder 26 aplica `protocols` só em mac/appx/linux; no NSIS a opção é ignorada. Por isso o `customInstall` de `build/installer.nsh` grava `HKCU\Software\Classes\algameet` (`URL Protocol`, `DefaultIcon` e `shell\open\command` = `"<Alga Meet.exe>" "%1"`). O `customUnInstall` apaga a chave, exceto em updates (`--updated`). A entrada `protocols` do `electron-builder.yml` fica para os outros alvos e documenta o esquema.
- **A URL é sempre o último argumento.** O Electron se recusa a iniciar quando há switches depois de um argumento URL (mitigação do CVE-2018-1000006). Assim, um link forjado com aspas não consegue injetar flags do Chromium/Node.
- **Dev: nada é registrado por padrão**, para um checkout não sequestrar o app instalado. Opt-in:
  - `ALGA_REGISTER_PROTOCOL=1` registra `electron.exe "<apps/desktop>" [--profile=<perfil>] "%1"` (`app.setAsDefaultProtocolClient`);
  - `ALGA_REGISTER_PROTOCOL=0` remove (`app.removeAsDefaultProtocolClient`, com o mesmo perfil).

  Instalar o app depois sobrescreve o registro de dev.

### Medições (2026-11-01, Windows 11 Pro 10.0.26300)

| Verificação | Resultado |
|---|---|
| `verify-native` (Playwright `_electron`), partida a frio com `--hidden` + link | `takePending()` devolve o link uma vez; a janela fica visível |
| Segundo processo real (`electron . --profile=e2e-native <link>`) com a janela minimizada | `onLink` recebe `{ kind: 'invite', code }`; a janela é restaurada e focada; o segundo processo sai com 0 |
| Links malformados via segundo processo | nenhum evento; 2 linhas `deep link rejected`; token e código ausentes do log |
| Caminho real do SO: `Start-Process 'algameet://invite/…'` com o registro de dev | o link chega ao `onLink` da instância em execução; com `=0` a chave some (conferido no registro) |
| Instalador | build ~23 s; instalação silenciosa 8,8 s cria a chave com `"…\Alga Meet.exe" "%1"`; desinstalação silenciosa remove a chave, a pasta, os atalhos e a entrada de desinstalação |

Não testado: abrir um link pelo **app instalado**. Ele usa o mesmo `userData` do perfil `default` de dev, que estava em uso, e o link iria para aquela instância.

## Token de sessão: API assíncrona do safeStorage (2026-11-01)

- `secure-store.ts` agora usa `isAsyncEncryptionAvailable`, `encryptStringAsync` e `decryptStringAsync`; a API síncrona está deprecada no Electron 45.
- **Compatibilidade.** Um `session.bin` gravado pelo `encryptString` antigo continua sendo lido. O `verify-native` grava um token com a API síncrona e o lê pelo bridge.
- **Rotação de chave.** Se `decryptStringAsync` responder `shouldReEncrypt`, o token é regravado com a chave atual. Uma falha nessa regravação é logada e o token continua sendo devolvido.
- **Regra mantida.** Sem criptografia disponível, o token fica só em memória; texto puro nunca vai para o disco.

## Verificações nativas visuais (2026-11-01, dev, perfil isolado `native-verify`)

| Item | Resultado | Captura |
|---|---|---|
| Toast do Windows | Aparece no canto inferior direito com o ícone do app (`icon.png`), título e corpo. Em dev o cabeçalho diz **"Electron"**: sem atalho no Menu Iniciar com o AppUserModelID, o Windows usa o nome do executável. No app instalado o atalho deve trocar isso por "Alga Meet" (não capturado). | `docs/screenshots/2026-11-01-native-toast.png` |
| Clique no toast | Clique real do mouse no corpo do toast. `onNotificationClick` recebeu `'native-verify'`. A janela minimizada foi restaurada e virou a janela em primeiro plano (antes estava outro app). Nada ficou na Central de Notificações. | — |
| Badge na barra de tarefas | `setBadge(7)`: círculo vermelho com "7" no botão do app; `setBadge(0)` remove. Em dev, todos os perfis (e o Electron de outros checkouts) dividem o mesmo AppUserModelID e o mesmo botão agrupado. | `2026-11-01-native-badge.png`, `2026-11-01-native-badge-cleared.png` |
| Iniciar com o Windows | `setStartAtLogin(true)`: `getStartAtLogin()` devolve `true` e `HKCU\…\Run\com.alga.meet` = `"…\electron.exe" "…\apps\desktop" --hidden`. `setStartAtLogin(false)` remove a entrada. O estado original do dono (desligado, sem entrada `Run` nem `StartupApproved`) foi restaurado e conferido no registro. | — |
| Partida com `--hidden` | Nenhuma janela visível, a bandeja é criada. O ícone ficou no overflow da bandeja ("^"), por isso não há captura útil. | — |

Como as capturas foram feitas: Playwright + `Graphics.CopyFromScreen` com processo DPI-aware. Nesta máquina o host dos toasts não aparece na UI Automation. O toast foi localizado por diferença de pixels contra uma captura anterior, e o clique só acontece se a caixa tiver o formato de um card de toast; senão o teste para sem clicar. A barra de tarefas se oculta sozinha, então o cursor foi levado à borda inferior esquerda e depois devolvido à posição original.
