; Alga Meet — NSIS hooks included by electron-builder (electron-builder.yml -> nsis.include).
; Saved as UTF-8 with BOM: makensis reads it as Unicode (pt-BR accents).
;
; One-click, per-user (%LOCALAPPDATA%\Programs, no UAC). NSIS does the real work (files, registry, shortcuts,
; electron-updater's silent updates); what people SEE is our own window, alga-setup-ui.exe (native/setup-ui + the
; src/setup page): started below for install and update, and registered as the uninstall entry. Without the
; WebView2 runtime nothing changes: NSIS's own progress window and questions.

Var algaUi

; WebView2 Evergreen runtime present? (per-machine in either registry view, or per-user)
!macro algaWebView2 _OUT
  StrCpy ${_OUT} ""
  ReadRegStr ${_OUT} HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} ${_OUT} == ""
    ReadRegStr ${_OUT} HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} ${_OUT} == ""
    ReadRegStr ${_OUT} HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} ${_OUT} == "0.0.0.0"
    StrCpy ${_OUT} ""
  ${EndIf}
!macroend

; Runs after $INSTDIR is known, before anything is touched. A double-click gets the install window; an
; electron-updater run (--updated /S) gets the small update card; other silent runs (/S) stay invisible.
; The window watches the work from outside, so NSIS goes silent and keeps doing exactly what it always did.
!macro customInit
  !insertmacro algaWebView2 $R9
  ${If} $R9 != ""
    ${IfNot} ${Silent}
      StrCpy $algaUi "install"
    ${ElseIf} ${isUpdated}
      StrCpy $algaUi "update"
    ${EndIf}
  ${EndIf}
  ${If} $algaUi != ""
    InitPluginsDir
    System::Call 'kernel32::GetCurrentProcessId() i .r0'
    CreateDirectory "$TEMP\AlgaMeetSetup"
    ClearErrors
    File "/oname=$TEMP\AlgaMeetSetup\alga-setup-ui-$0.exe" "${BUILD_RESOURCES_DIR}\bin\alga-setup-ui.exe"
    ${IfNot} ${Errors}
      Exec '"$TEMP\AlgaMeetSetup\alga-setup-ui-$0.exe" --mode $algaUi --dir "$INSTDIR" --work "$PLUGINSDIR" --kb ${APP_64_UNPACKED_SIZE} --parent $0 --exe "${APP_EXECUTABLE_FILENAME}" --data "$APPDATA\${PRODUCT_NAME}" --installer "$EXEPATH" --version ${VERSION}'
      SetSilent silent
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  !ifndef ALGA_SANDBOX
    ; algameet:// deep links (per-user, HKCU\Software\Classes). The URL is the last argument: Electron refuses
    ; to start when switches follow a URL argument (CVE-2018-1000006 mitigation), so a crafted link cannot inject flags.
    WriteRegStr HKCU "Software\Classes\algameet" "" "URL:Alga Meet"
    WriteRegStr HKCU "Software\Classes\algameet" "URL Protocol" ""
    WriteRegStr HKCU "Software\Classes\algameet\DefaultIcon" "" "$appExe,0"
    WriteRegStr HKCU "Software\Classes\algameet\shell\open\command" "" '"$appExe" "%1"'
  !endif

  ; "Desinstalar" in Windows opens our window. electron-builder's next update runs this same entry with
  ; "/S ... _?=<dir>": alga-setup-ui then forwards to the real uninstaller without a window (native/setup-ui).
  ${If} ${FileExists} "$INSTDIR\resources\bin\alga-setup-ui.exe"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\resources\bin\alga-setup-ui.exe" --mode uninstall --dir "$INSTDIR"'
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\resources\bin\alga-setup-ui.exe" --mode uninstall --dir "$INSTDIR" /S'
  ${EndIf}
!macroend

!macro customUnInstall
  ; Updates run the old uninstaller silently with --updated: never touch user state then.
  ${ifNot} ${isUpdated}
    !ifndef ALGA_SANDBOX
      DeleteRegKey HKCU "Software\Classes\algameet"
      ; "Iniciar com o Windows" entry written by app.setLoginItemSettings (value name = AppUserModelId).
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.alga.meet"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.alga.meet"
    !endif

    ; Personal data stays unless the person chooses to remove it: the switch in our uninstall window passes
    ; --delete-app-data; the plain uninstaller asks. A silent uninstall (/S) without the flag keeps it.
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${IfNot} ${Errors}
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
    ${ElseIfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Deseja também remover seus dados pessoais do Alga Meet?$\r$\n$\r$\nIsso apaga sua sessão, suas configurações e os registros do aplicativo em:$\r$\n$APPDATA\${PRODUCT_NAME}$\r$\n$\r$\nEscolha Não para mantê-los (recomendado se você for reinstalar)." /SD IDNO IDNO alga_keep_data
        RMDir /r "$APPDATA\${PRODUCT_NAME}"
      alga_keep_data:
    ${EndIf}
  ${endIf}
!macroend
