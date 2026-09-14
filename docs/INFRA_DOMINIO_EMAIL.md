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

## Domínio autenticado no Brevo — feito em 2026-09-14

`institutofacaamigos.com.br` está com `authenticated: true` /
`verified: true` na API do Brevo (`GET /v3/senders/domains`), confirmado
também via DNS ao vivo (DNS-over-HTTPS). Registros publicados hoje no
Netlify DNS (painel Netlify → Domains → institutofacaamigos.com.br → DNS
settings):

```
@                 TXT    brevo-code:cd6044541926004cf1be5862617bd03e
brevo1._domainkey CNAME  b1.institutofacaamigos-com-br.dkim.brevo.com
brevo2._domainkey CNAME  b2.institutofacaamigos-com-br.dkim.brevo.com
_dmarc            TXT    v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com
```

**Pendente**: SPF. O Brevo não exige para marcar o domínio como
autenticado (DKIM já cobre alinhamento DMARC), mas sem SPF qualquer
servidor pode tentar enviar como se fosse este domínio. Adicionar:

```
@                 TXT    v=spf1 include:spf.brevo.com -all
```

`-all` é seguro aqui porque não existe MX/caixa própria — nenhum outro
servidor deveria estar autorizado a enviar como esse domínio. Depois de
~2 semanas sem falso positivo de spam, considerar subir o DMARC de
`p=none` para `p=quarantine` (o `rua` atual vai para o próprio Brevo, não
para uma caixa do dono — trocar para `institutofacaamigos@gmail.com` se
quiser ver os relatórios agregados diretamente).

Quando a zona migrar para a Vercel (seção seguinte), estes 5 registros
(os 4 já publicados + o SPF) precisam ser recriados lá antes da troca de
nameservers, senão a autenticação quebra de novo.

Consulta feita via API do Brevo (`api-key`), não pelo painel — a conta
tinha restrição de IP autorizado ativa (Segurança → IPs autorizados), que
bloqueava chamadas de qualquer IP fora da lista; como o ambiente que faz
essas chamadas não tem IP de saída fixo, a única forma de automatizar foi
desativar essa restrição para chaves de API (Segurança → IPs autorizados
→ "Desativar para chaves API"). Consequência: qualquer chave de API do
Brevo desta conta agora aceita chamadas de qualquer IP, não só dos
autorizados — reavaliar se vale reativar depois que a automação inicial
estiver concluída.

## Zona DNS: migração do Netlify para a Vercel — CONCLUÍDA em 2026-09-14

Passo a passo que foi seguido, para referência futura (ex.: repetir o
padrão em outro domínio):

1. Criar os projetos Vercel, adicionar os domínios/subdomínios a cada
   um, e ao adicionar o apex (`institutofacaamigos.com.br`) escolher
   "Nameservers (Vercel DNS)" — cria a zona na Vercel. Validar cada
   projeto pela URL `*.vercel.app` antes de prosseguir.
2. Recriar na zona Vercel todos os registros que existiam no Netlify,
   incluindo os 5 do Brevo (seção acima).
3. Só então trocar os nameservers no Registro.br para
   `ns1.vercel-dns.com` / `ns2.vercel-dns.com`.
4. Depois da propagação, confirmar no Brevo que o domínio continua
   "Autenticado".

**Desvio da recomendação original**: o plano inicial era manter a zona
do Netlify por 30 dias como caminho de rollback (bastava voltar os
nameservers). O dono decidiu desligar o site Netlify imediatamente após
confirmar que a Vercel funcionava (mesmo dia), abrindo mão desse
caminho de rollback em troca de não manter infraestrutura duplicada. O
site Netlify (`facaamigos`, o que tinha o domínio) foi excluído e
confirmado via API como removido da conta. **Não existe mais rollback
por troca de nameserver** — qualquer problema encontrado depois disso
precisa ser corrigido na própria configuração da Vercel, não revertido.

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

**Atualizado em 2026-09-14**: o domínio já está autenticado no Brevo (seção
acima), então a recomendação passou a ser usar o relay do Brevo **direto**,
sem precisar do Gmail como estágio intermediário. Dados do relay obtidos
via `GET /v3/account` (endpoint `relay.data`):

- Host: `smtp-relay.brevo.com`, porta 587
- Usuário: `b8aba1001@smtp-brevo.com`
- Senha: a própria API key do Brevo (Settings → SMTP & API → API Keys) —
  não é uma senha separada
- Remetente: `instituto@institutofacaamigos.com.br`

Isso mantém o remetente no domínio próprio com DKIM/DMARC alinhados desde
o primeiro envio, sem a pegadinha do Gmail (remetente `@gmail.com`,
limite de ~500/dia). `institutofacaamigos@gmail.com` (decisão do dono,
2026-09-14) continua sendo o Reply-To padrão em todo envio automático dos
três apps — só deixou de ser necessário como *stopgap* de SMTP em si.

Configurar em **cada um dos dois projetos**:
Authentication → Emails → SMTP Settings → "Enable Custom SMTP" → host/
porta/usuário/senha/remetente. A senha (API key do Brevo, ou a senha de
app do Gmail, caso ainda se opte por essa via) só entra nesse campo do
painel Supabase — **nunca em código, `.env` versionado ou secret de Edge
Function**. Se ela já foi compartilhada em texto puro em algum lugar
(chat, e-mail, etc.), o mais seguro é considerá-la exposta: gerar uma API
key nova no Brevo (ou revogar a senha de app do Gmail e criar outra)
depois de configurar, e usar só a nova daí em diante.

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

- [x] `https://dns.google/resolve?name=<host>&type=A` resolve para a
  Vercel em todos os 6 hosts da tabela de mapa de subdomínios —
  confirmado em 2026-09-14.
- [x] TXT `brevo-code`, `v=spf1` e os 2 CNAME `_domainkey` presentes;
  Brevo mostra o domínio como "Autenticado" — confirmado via API do
  Brevo em 2026-09-14.
- [x] Cada domínio serve o conteúdo certo (apex/www → hub, playground.
  → landing, app./sistema./rh. → cada app) — confirmado com requisição
  real (DNS já propagado, sem truque de teste) em 2026-09-14.
- [x] SMTP customizado configurado nos dois projetos Supabase reais
  (`ivjvpdzsfjdpyabbzzuj`, `vththexblpxwocbowhsv`) via Management API,
  usando o relay do Brevo.
- [ ] **Não testado ainda**: um e-mail de teste de cada app chegando de
  fato numa caixa real com `DKIM=pass`/`SPF=pass`/`DMARC=pass` visíveis
  no cabeçalho, e um convite de usuário via Supabase Auth chegando em
  menos de 1 minuto. A configuração está feita e os registros de
  autenticação batem, mas ninguém dessa sessão enviou um e-mail de
  ponta a ponta para confirmar a entrega na caixa de entrada (só a
  autenticação do domínio, que é pré-requisito, não a entrega em si).
