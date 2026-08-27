; Regra de Firewall do Windows para a porta 7317 (servidor Fastify local,
; ver apps/kiosk/src/server/start.ts) — é o que permite os tablets da LAN
; acessarem o kiosk. Precisa rodar elevado, por isso perMachine +
; allowElevation no electron-builder.yml.

!macro customInstall
  DetailPrint "Configurando regra de Firewall para FacaAmigos Kiosk (porta 7317)..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FacaAmigos Kiosk"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FacaAmigos Kiosk" dir=in action=allow protocol=TCP localport=7317 profile=private,domain'
!macroend

!macro customUnInstall
  DetailPrint "Removendo regra de Firewall do FacaAmigos Kiosk..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FacaAmigos Kiosk"'
!macroend
