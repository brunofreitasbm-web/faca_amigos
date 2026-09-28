# Relatório de Sessão — deploy

Sessões com plano de 1h ou mais geram um relatório de observação (mapa por setor,
3 níveis clicáveis) que o profissional preenche em até 40 min após a saída.
O resumo vai ao WhatsApp do responsável com texto redigido por IA (Gemini).

## 1. Banco

```bash
supabase db push
```

Aplica `20260928170000_fa_session_reports.sql`. Ela precisa rodar **depois** de
`20260928160000_fa_crm_renewal_alert.sql`: as duas redefinem a constraint
`fa_crm_templates_purpose_check` e a lista final (`GERAL`, `NPS`, `RENOVACAO`,
`RELATORIO_SESSAO`) está na mais nova. Quem acrescentar outra finalidade depois
tem que repetir a lista inteira.

Cria: coluna `sector` em `fa_kiosk_employees`, tabela `fa_kiosk_session_reports`,
RPCs `fa_session_reports_pending`, `fa_session_reports_recent`,
`fa_session_report_submit`, `fa_session_report_mark_dispatch` (só service role),
`fa_config_set_employee_sector`, e as capacidades `relatorio_sessao.write`
(todos os papéis) e `relatorio_sessao.read` (Líder e Owner).

## 2. Edge function

```bash
supabase functions deploy session-report-dispatch
```

Segredos já existentes e usados: `GEMINI_API_KEY`, `TWILIO_CRM_ACCOUNT_SID`,
`TWILIO_CRM_AUTH_TOKEN`. Sem `GEMINI_API_KEY` a função não falha: envia o texto
padrão montado das respostas (`ai_fallback = true`).

`verify_jwt` fica LIGADO (chamada autenticada pela SPA). Não copie o
`verify_jwt = false` do webhook.

## 3. Template do WhatsApp (obrigatório para enviar)

Fora da janela de 24h o WhatsApp só aceita template aprovado, e o responsável
quase nunca escreveu nas últimas 24h. Sem template ativo o relatório fica salvo
e o envio mostra "Aguardando modelo de mensagem aprovado"; depois de aprovado,
o botão **Reenviar** resolve.

1. Twilio → Content Template Builder, categoria **Utility**, idioma `pt_BR`,
   3 variáveis:

   ```
   Olá {{1}}! Aqui é a equipe do FaçaAmigos 💛 Hoje acompanhamos de perto a sessão de {{2}} e queremos compartilhar com você: {{3}} Qualquer dúvida, é só responder esta mensagem.
   ```

   Variáveis: `{{1}}` primeiro nome do responsável, `{{2}}` primeiro nome da
   criança, `{{3}}` texto da IA (parágrafo único, até 700 caracteres).
2. Submeta para aprovação da Meta (pode levar de horas a dias).
3. Depois de aprovado, cadastre:

   ```sql
   insert into fa_crm_templates (name, content_sid, preview, variable_count, purpose)
   values (
     'Relatório de Sessão',
     'HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
     'Olá {{1}}! Aqui é a equipe do FaçaAmigos 💛 Hoje acompanhamos de perto a sessão de {{2}} e queremos compartilhar com você: {{3}} Qualquer dúvida, é só responder esta mensagem.',
     3,
     'RELATORIO_SESSAO'
   );
   ```

## 4. Quem recebe

O envio segue as mesmas travas do NPS automático:

| Situação | Resultado no relatório |
|---|---|
| Responsável sem aceite de WhatsApp (`whatsapp_consent_at_ms`) | `SKIPPED_NO_CONSENT` |
| Sem telefone no cadastro | `SKIPPED_NO_PHONE` |
| Sem canal ativo para a unidade (`fa_crm_channels`) | `SKIPPED_NO_CHANNEL` |
| Contato mandou PARAR | `SKIPPED_OPT_OUT` |
| Sem template `RELATORIO_SESSAO` ativo e janela fechada | `SKIPPED_NO_TEMPLATE` |
| Twilio recusou | `FAILED` |

Em todos os casos o relatório fica salvo. O canal da unidade é escolhido por
`unit_id`; com Playground e Circuito na mesma unidade, o rótulo do canal precisa
conter "Circuito" para casar com sessões de carrinho.

## 5. Setor dos colaboradores

Gerencial → Equipe & Operadores: cada colaborador tem um seletor **Setor**
(Educação Física, Psicologia, Terapia Ocupacional, Pedagogia). O setor abre
primeiro no formulário e é gravado como "setor no momento do preenchimento".
Colaborador sem setor vê todos os blocos, na ordem padrão.

## 6. Verificação manual

1. Check-in de criança com plano de 2h e saída. A sessão aparece em
   **Relatórios de Sessão** com contagem regressiva; sessão de 30 min não aparece.
2. Preencher como Estagiário e enviar. O card em "Enviados hoje" vira
   "Enviado ao responsável" e a mensagem chega no WhatsApp de teste.
3. Linha do tempo da sessão mostra "Relatório de sessão preenchido".
4. Preencher depois de 40 min: badge "fora do prazo" e `late = true`.
5. Gerencial → Relatórios de Sessão lista, filtra e abre o detalhe.
6. Reenviar um relatório já enviado não duplica a mensagem.

## 7. Limitações conhecidas

- O texto da IA vai sem revisão humana (decisão de produto). Duas travas:
  falha da IA ou termo clínico proibido (transtorno, déficit, laudo, TEA, TDAH…)
  trocam o texto pelo padrão do sistema.
- Funções de edge não passam por checagem de tipos localmente (sem Deno no
  ambiente de desenvolvimento): confira no primeiro deploy pelos logs.
- O envio offline: o relatório entra na fila local e o envio ao responsável é
  feito pelo botão **Reenviar** quando a rede voltar.
