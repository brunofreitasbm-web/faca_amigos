# Domínio, DNS, e-mail e hospedagem — institutofacaamigos.com.br

Runbook único para os quatro sistemas do ecossistema (`clinica_facaamigos`,
`faca_amigos`, `langing_page_faca_amigos`, `controle-de-estagiario`).
Escrito durante a migração de setembro/2026: DNS saindo do Netlify e
indo para a Vercel, todos os apps consolidados na Vercel, e envio de
e-mail padronizado no Brevo.

## Por que isso mudou

Diagnóstico com DNS ao vivo em 2026-09-14: o Registro.br **não hospeda
registro nenhum** — a tela "Alterar servidores DNS" só troca os
nameservers. O domínio estava delegado para o Netlify DNS
(`dns1-4.p03.nsone.net`), mas os registros do Brevo (TXT, DKIM, DMARC)
nunca tinham sido criados em lugar nenhum — nem no Netlify, nem no
Registro.br. Resultado: e-mails saindo de `instituto@institutofacaamigos.com.br`
sem autenticação (sem SPF/DKIM/DMARC), e os subdomínios `app.` e
`clinica.` (agora `sistema.`) sem registro DNS nenhum — por isso o card
`faca_amigos` aparecia com "!" no dashboard da Vercel.

## Mapa de subdomínios (decidido pelo dono, 2026-09-14)

| Host | Serve | Projeto Vercel |
|---|---|---|
| `institutofacaamigos.com.br` (apex) | `hub.html` (hub com links para Clínica/Playground/Circuito) | `facaamigos-site` |
| `www.institutofacaamigos.com.br` | redirect 308 para o apex | `facaamigos-site` |
| `playground.institutofacaamigos.com.br` | `index.html` (landing do Playground) | `facaamigos-site` |
| `app.institutofacaamigos.com.br` | kiosk-ui (SPA + API do quiosque) | `faca_amigos` (root `apps/kiosk-ui`) |
| `sistema.institutofacaamigos.com.br` | `clinica_facaamigos` (Next.js) | `clinica-facaamigos` |
| `rh.institutofacaamigos.com.br` | `controle-de-estagiario` (Vite SPA) | `controle-de-estagiario` |

`sistema.` foi a escolha final para a clínica — `clinica.institutofacaamigos.com.br`
nunca chegou a ter registro DNS, então não existe nada para redirecionar.

## Sem caixa de entrada no domínio

Decisão do dono: `institutofacaamigos.com.br` só **envia** e-mail (via
Brevo). Não existe Google Workspace nem qualquer outra caixa postal no
domínio — por isso **nenhum registro MX** entra na zona. Consequência
prática: todo envio automático (Brevo REST, Supabase Auth SMTP) precisa
de `Reply-To` apontando para uma caixa que alguém realmente lê, senão
qualquer resposta de paciente/responsável volta com erro de entrega.

- `clinica_facaamigos`: `lib/email.ts` exporta `DEFAULT_REPLY_TO` (env
  `BREVO_REPLY_TO`, cai em `institutofacaamigos@gmail.com` se não setado).
- `faca_amigos`: `supabase/functions/owner-email-dispatch/index.ts` lê
  `BREVO_REPLY_TO` da mesma forma (mesmo fallback).
- `controle-de-estagiario`: `supabase/functions/notify-professional-nfse/index.ts`
  também lê `BREVO_REPLY_TO` (mesmo fallback), além de `BREVO_FROM`/
  `BREVO_SENDER_EMAIL`.

**Resolvido em 2026-09-14**: `CLINIC_SUPPORT_EMAIL` em
`clinica_facaamigos/lib/clinic-identity.ts` e o `DEFAULT_REPLY_TO` dos três
apps agora apontam para `institutofacaamigos@gmail.com` — caixa real
monitorada pelo dono, definida nesta data. Não é o ideal (não é o domínio
próprio, e SMTP autenticado por essa conta não pode assinar mensagens
"From: @institutofacaamigos.com.br" sem um alias verificado, o que não é
possível hoje sem MX) — mas resolve o problema real: antes não existia
inbox nenhum para onde uma resposta pudesse ir.

## Autenticar o domínio no Brevo — não depende da migração de DNS

O domínio `institutofacaamigos.com.br` já foi adicionado no Brevo (Senders,
Domains & Dedicated IPs → Domains) — a tela de "Adicionar registros" já
mostra o código de verificação e os dois CNAME de DKIM. **Isso pode ser
concluído agora mesmo, sem esperar a migração de hospedagem para a
Vercel**: os registros só precisam existir em algum lugar que responda
pelo domínio — hoje isso ainda é o Netlify DNS (painel Netlify → Domains →
institutofacaamigos.com.br → DNS settings → Add new record). Adicionar lá:

```
@                 TXT    brevo-code:<valor exato da tela do Brevo>
brevo1._domainkey CNAME  <valor exato da tela do Brevo>
brevo2._domainkey CNAME  <valor exato da tela do Brevo>
_dmarc            TXT    v=DMARC1; p=none; rua=mailto:institutofacaamigos@gmail.com
@                 TXT    v=spf1 include:spf.brevo.com -all
```

`-all` no SPF é seguro aqui porque não existe MX/caixa própria — nenhum
outro servidor deveria estar autorizado a enviar como esse domínio. Depois
de ~2 semanas sem falso positivo de spam, subir o DMARC de `p=none` para
`p=quarantine`. Depois de adicionar, esperar a propagação (minutos a
poucas horas — conferir com `https://dns.google/resolve?name=institutofacaamigos.com.br&type=TXT`)
e no Brevo clicar "Verificar registros" → "Autenticar domínio". Quando a
zona migrar para a Vercel (seção seguinte), os mesmos 5 registros precisam
ser recriados lá antes da troca de nameservers, senão a autenticação quebra
de novo.

## Zona DNS: migrando do Netlify para a Vercel

1. **Antes de tocar no Registro.br**: criar os 4 projetos Vercel da
   tabela acima, adicionar os domínios/subdomínios a cada um, e ao
   adicionar o apex (`institutofacaamigos.com.br`) ao projeto
   `facaamigos-site` escolher a opção "Nameservers (Vercel DNS)" — isso
   cria a zona Vercel. Validar cada projeto pela URL `*.vercel.app`
   antes de prosseguir.
2. **Exportar a zona atual do Netlify** (painel Netlify → Domains →
   institutofacaamigos.com.br → DNS settings) antes de desligar
   qualquer coisa, para não perder registros de verificação
   (Search Console, os 5 registros do Brevo acima, etc.) que já existam
   lá.
3. **Recriar na zona Vercel** (painel Domains → DNS Records, ou
   `vercel dns add institutofacaamigos.com.br ...`) todos os registros
   exportados no passo 2, incluindo os 5 do Brevo.
4. **Só então trocar os nameservers no Registro.br** para
   `ns1.vercel-dns.com` / `ns2.vercel-dns.com`. Trocar antes da zona
   Vercel estar completa derruba o site raiz e o playground — o
   Registro.br valida que os nameservers já respondem antes de aceitar.
5. Depois da propagação (checar com
   `https://dns.google/resolve?name=<host>&type=A`), confirmar no Brevo
   que o domínio continua "Autenticado" (a mudança de nameserver não deve
   derrubar a autenticação se os registros foram recriados corretamente).
6. **Não apagar a zona do Netlify por 30 dias** — é o caminho de
   rollback: basta voltar os nameservers para `dns1.p03.nsone.net` etc.

## Remetentes de e-mail (padronizados nesta migração)

| App | Antes | Depois |
|---|---|---|
| `clinica_facaamigos` (Brevo, `lib/email.ts`) | `instituto@institutofacaamigos.com.br` | sem mudança — `BREVO_REPLY_TO` adicionado |
| `clinica_facaamigos` edge function `sync-grupoib-professional` | `nao-responda@facaamigos.com.br` (domínio de outra empresa — uma gráfica em SP, ver aviso em `lib/clinic-identity.ts`) | `instituto@institutofacaamigos.com.br` |
| `faca_amigos` edge function `owner-email-dispatch` | Gmail SMTP, `hub.operacao.lojas@gmail.com` | Brevo REST, mesmo remetente/domínio dos outros apps |
| `faca_amigos` push (`VAPID_SUBJECT`) | `mailto:contato@facaamigos.com.br` | `mailto:instituto@institutofacaamigos.com.br` |
| `controle-de-estagiario` edge function `notify-professional-nfse` | `BREVO_FROM` obrigatório, sem Reply-To | `BREVO_REPLY_TO` adicionado (mesmo fallback `institutofacaamigos@gmail.com`) — configurar `BREVO_FROM` na Vercel/Supabase apontando para `instituto@institutofacaamigos.com.br` continua pendente, é config de secret, não de código |

## Supabase Auth (convites, reset de senha)

Só existem **dois** projetos Supabase reais no ecossistema, não três — a
clínica (`clinica_facaamigos`) e o RH (`controle-de-estagiario`)
compartilham o mesmo projeto:

| Projeto Supabase | ref | Usado por | Link direto |
|---|---|---|---|
| `controle-caixa` | `ivjvpdzsfjdpyabbzzuj` | `faca_amigos` / kiosk | `app.supabase.com/project/ivjvpdzsfjdpyabbzzuj/auth/providers` (SMTP em Auth → Emails → SMTP Settings) |
| `controle-de-estagiario` | `vththexblpxwocbowhsv` | `controle-de-estagiario` **e** `clinica_facaamigos` (mesmo backend) | `app.supabase.com/project/vththexblpxwocbowhsv/auth/providers` |

Hoje os dois usam o mailer built-in (limite baixo, remetente
`noreply@mail.app.supabase.io`) — é a causa mais provável de "convite não
chegou".

**Decisão do dono (2026-09-14)**: usar `institutofacaamigos@gmail.com`
(Gmail SMTP, com senha de app) como stopgap, em vez de esperar a
autenticação do domínio no Brevo terminar. Isso funciona e é **melhor do
que o mailer padrão do Supabase** (sem o limite de poucos e-mails por
hora), mas tem duas pegadinhas que valem registrar:
- O remetente efetivo será `institutofacaamigos@gmail.com`, não um
  endereço `@institutofacaamigos.com.br` — o Gmail rejeita (ou reescreve)
  um `From` que não seja a própria conta autenticada, a menos que se
  configure um alias verificado em "Enviar como" nas configurações do
  Gmail, o que exige receber um código de confirmação no domínio — hoje
  impossível, sem MX. Ou seja: e-mail de convite virá visivelmente do
  Gmail até o domínio ter caixa própria.
- Limite de envio de conta Gmail pessoal: ~500 destinatários/dia. Tranquilo
  para convite/reset, mas não escalar esse mesmo SMTP para newsletters ou
  campanhas.

Assim que a autenticação do Brevo estiver concluída (seção acima), trocar
para o relay do Brevo é a melhora natural — mantém o remetente no domínio
próprio com DKIM/SPF alinhados:
- Host: `smtp-relay.brevo.com`, porta 587
- Usuário/senha: login Brevo + uma SMTP key gerada em
  Settings → SMTP & API
- Remetente: `instituto@institutofacaamigos.com.br`

Em qualquer um dos dois casos, configurar em **cada um dos dois projetos**:
Authentication → Emails → SMTP Settings → "Enable Custom SMTP" → host/
porta/usuário/senha/remetente. A senha do Gmail (senha de app, gerada nas
configurações de segurança da conta Google) só entra nesse campo do
painel Supabase — **nunca em código, `.env` versionado ou secret de Edge
Function**. Se ela já foi compartilhada em texto puro em algum lugar (chat,
e-mail, etc.), o mais seguro é revogar essa senha de app específica depois
de configurada e gerar uma nova.

E em Authentication → URL Configuration, atualizar Site URL e Redirect
URLs para os hosts finais (`sistema.`, `app.`, `rh.`), mantendo os
`*.vercel.app` até o cutover estar validado.

## Webhooks que dependem da URL pública

- Twilio (WhatsApp/SMS/Voice) em `clinica_facaamigos`: o webhook em
  `app/api/webhooks/twilio/route.ts` valida `X-Twilio-Signature` contra
  `TWILIO_WEBHOOK_URL` — essa env **tem que ser exatamente** a URL
  configurada no Twilio Console, ou toda mensagem é rejeitada. Ao trocar
  para `sistema.institutofacaamigos.com.br`, atualizar os dois lados ao
  mesmo tempo.
- pg_cron dos dois projetos lê `app.settings.app_url`
  (`current_setting('app.settings.app_url', true)`), configurado uma vez
  via `ALTER DATABASE postgres SET app.settings.app_url = '<url>'` — não
  é uma migration versionada, é comando manual no SQL editor do Supabase.
  Atualizar para `https://sistema.institutofacaamigos.com.br`.
- `apps/kiosk-ui` e `apps/kiosk` (Electron): fallback público mudou de
  `kiosk-ui.vercel.app` para `app.institutofacaamigos.com.br`
  (`apps/kiosk-ui/src/lib/appUrl.ts`, `apps/kiosk/src/main/main.ts`).
  `kiosk-ui.vercel.app` continua na allowlist de CORS
  (`supabase/functions/_shared/http.ts`) durante a transição — remover
  depois que nenhum terminal antigo estiver mais apontando para lá.

## Automação futura ("via MCP")

Nem o Netlify MCP nem o Vercel MCP conectados nesta sessão expõem
operações de registro DNS — só leitura de projetos/deploys. O que já é
automatizável hoje sem painel:

- **DNS**: `vercel dns add|rm|ls|import` e `vercel domains` via Vercel
  CLI com um token (`VERCEL_TOKEN`). Se quiser DNS como código, versionar
  um arquivo de zona e importar com `vercel dns import`.
- **Supabase**: MCP já conectado cobre `secrets`, migrations e deploy de
  edge functions.
- **GitHub**: MCP já conectado cobre PRs, branches e CI.

Antes de contar com o Vercel MCP para qualquer coisa: nesta sessão ele
não enxergava os projetos (`list_projects` vazio, `get_project` 404) no
team `bruno-bm-projects` — provavelmente o conector está ligado a um
team diferente do que os projetos realmente vivem. Corrigir isso é
pré-requisito para qualquer automação futura via MCP.

## Verificação (critério de "está funcionando")

- `https://dns.google/resolve?name=<host>&type=A` resolve para a Vercel
  em todos os 6 hosts da tabela de mapa de subdomínios.
- TXT `brevo-code`, `v=spf1` e os 2 CNAME `_domainkey` presentes; Brevo
  mostra o domínio como "Autenticado".
- Um e-mail de teste de cada app (assinatura da clínica, relatório do
  owner, nfse do RH) chega numa caixa Gmail com `DKIM=pass`, `SPF=pass`,
  `DMARC=pass` e o `Reply-To` correto.
- Convite de usuário via Supabase Auth chega em menos de 1 minuto.
- Nenhum projeto aparece com "!" no dashboard da Vercel.
