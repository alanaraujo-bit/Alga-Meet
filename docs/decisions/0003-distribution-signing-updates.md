# 0003 — Distribuição, assinatura de código e atualizações

- Status: **aceita** (2026-11-01). A assinatura de código depende de uma ação humana (ver "Bloqueios").
- Escopo: `apps/desktop/electron-builder.yml`, `apps/desktop/build/installer.nsh`, `apps/desktop/src/main/updater.ts`

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
