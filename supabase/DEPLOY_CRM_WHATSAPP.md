# CRM WhatsApp (Playground + Circuito) — deploy

Subconta Twilio dedicada: `FacaAmigos Playground e Circuito` (SID e token em `.env.local` como `TWILIO_CRM_ACCOUNT_SID` / `TWILIO_CRM_AUTH_TOKEN`; nunca commitar).

## 1. Banco
Aplicar `migrations/20260928120000_fa_crm_whatsapp.sql` (projeto `ivjvpdzsfjdpyabbzzuj`).

## 2. Secrets das Edge Functions
```
supabase secrets set TWILIO_CRM_ACCOUNT_SID=AC... TWILIO_CRM_AUTH_TOKEN=...
```
Opcional: `CRM_WEBHOOK_PUBLIC_URL` (padrão: `https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook`).
Precisa ser idêntica à URL cadastrada na Twilio — a assinatura é calculada sobre ela.

## 3. Deploy
```
supabase functions deploy crm-whatsapp-webhook   # verify_jwt=false (config.toml)
supabase functions deploy crm-whatsapp-send
```

## 4. Número (quando o chip chegar)
1. Twilio Console (subconta) > Messaging > Senders > WhatsApp senders > Self sign-up; verificar o chip por SMS/ligação.
2. Nesse sender, "Webhook URL for incoming messages" = URL do `crm-whatsapp-webhook`.
3. Cadastrar o canal:
```sql
insert into fa_crm_channels (unit_id, label, whatsapp_e164)
values ('<uuid da unidade>', 'Playground', '+5591XXXXXXXXX');
```
Para testar antes: sandbox da Twilio, `whatsapp_e164 = '+14155238886'`, `is_sandbox = true`.

## 5. Templates (mensagens fora da janela de 24h)
Criar no Twilio Content Template Builder, aguardar aprovação da Meta, e registrar:
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count)
values ('Boas-vindas', 'HX...', 'Olá {{1}}! Obrigado por visitar o FaçaAmigos 💛', 1);
```

## Permissões
`crm.read` / `crm.write`: Líder e Owner. `crm.admin` (canais/templates): Owner. Ajustáveis em Gerencial > Permissões.

## NPS por WhatsApp
A pesquisa saiu da tela pública de acompanhamento e passou a ser enviada pelo CRM (`crm-nps-send`, botão "Enviar NPS" na conversa ou em lote). Cada número pergunta sobre a própria marca (Playground ou Circuito). A resposta 0-10 e o comentário são tratados em `crm-whatsapp-webhook` e aparecem no feed de NPS da Visão Geral Owner.

Cadastrar o template aprovado pela Meta (variável {{1}} = primeiro nome):
```sql
insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose)
values ('NPS pós-visita', 'HX...', 'Olá {{1}}! Como foi sua visita ao FaçaAmigos? De 0 a 10, o quanto você nos recomendaria a um amigo? Responda só com o número. 💛', 1, 'NPS');
```
Proteções: máx. 100 contatos por envio; pula quem pediu PARAR e quem recebeu NPS nos últimos 30 dias.
