; Alga Meet — NSIS hooks included by electron-builder (electron-builder.yml -> nsis.include).
; Saved as UTF-8 with BOM: makensis reads it as Unicode (pt-BR accents).

; Always per-user (%LOCALAPPDATA%Programs, no UAC): skip the "all users / only me" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Welcome page with the branded sidebar (electron-builder's assisted installer has none by default).
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; algameet:// deep links (per-user, HKCU\Software\Classes). The URL is the last argument: Electron refuses
; to start when switches follow a URL argument (CVE-2018-1000006 mitigation), so a crafted link cannot inject flags.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\algameet" "" "URL:Alga Meet"
  WriteRegStr HKCU "Software\Classes\algameet" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\algameet\DefaultIcon" "" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\algameet\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  ; Updates run the old uninstaller silently with --updated: never touch user state then.
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\algameet"
    ; "Iniciar com o Windows" entry written by app.setLoginItemSettings (value name = AppUserModelId).
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.alga.meet"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.alga.meet"

    ; Personal data stays unless the user explicitly chooses to remove it. Silent uninstall (/S) keeps it.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Deseja também remover seus dados pessoais do Alga Meet?$\r$\n$\r$\nIsso apaga sua sessão, suas configurações e os registros do aplicativo em:$\r$\n$APPDATA\Alga Meet$\r$\n$\r$\nEscolha Não para mantê-los (recomendado se você for reinstalar)." /SD IDNO IDNO alga_keep_data
      RMDir /r "$APPDATA\Alga Meet"
    alga_keep_data:
  ${endIf}
!macroend
