# Olhar FaçaAmigos (antigo Relatório de Sessão) — deploy

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

## Olhar FaçaAmigos em PDF (link no WhatsApp)

Migration `20260930000000_fa_session_report_pdf.sql` + functions `session-report-dispatch` (alterada), `session-report-view` (nova, `verify_jwt = false`) e o template `RELATORIO_SESSAO_PDF` (bootstrap).

**Fluxo:** `session-report-dispatch` pede ao Gemini UM JSON (`titulo`, `abertura`, `areas{movimento, convivencia, autonomia, atencao}`, `fechamento`, `destaque_whatsapp`), valida formato + termos proibidos em todos os campos (qualquer falha → documento inteiro pelo fallback determinístico, `ai_fallback=true`), desenha o A4 com `pdf-lib` (`_shared/sessionReportPdf.ts`), sobe em `relatorios-sessao/<unit_id>/<report_id>.pdf` (bucket privado, só service role escreve) e grava `pdf_path`, `ai_report` e o `public_token` (256 bits, definido **uma vez** — Reenviar/Regerar mantêm o link).

**Link:** `https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/session-report-view?t=<token>` → conta a visualização (`pdf_view_count`) → 302 para signed URL de 1h. Token inválido → site público (a Meta testa a URL de amostra do botão).

**Mensagem:** janela de 24h aberta → texto livre com o link; senão template `RELATORIO_SESSAO_PDF` (`twilio/call-to-action`, botão "Abrir Olhar", variáveis `{{1}}` responsável, `{{2}}` criança, `{{3}}` destaque, `{{4}}` token no sufixo da URL); enquanto ele não estiver aprovado, cai no `RELATORIO_SESSAO` de texto com o link dentro de `{{3}}`.

**Blindagem:** o PDF traz nota fixa (fora da IA) de que é registro meramente observacional da brincadeira — não é sessão terapêutica, atendimento, avaliação, diagnóstico, laudo ou parecer — na 1ª página e resumida no rodapé de todas. O documento se chama "Olhar FaçaAmigos"; o prompt e o filtro `FORBIDDEN` também barram sessão/atendimento/evolução/desenvolvimento/habilidade/etc. Os itens e níveis (pílulas) vêm do catálogo, nunca da IA.

**Assets:** fontes OFL (Fredoka One, Nunito 400/700) e logo em base64 em `_shared/assets/brandAssets.ts`. Para trocar, coloque os arquivos em `_shared/assets/src/` e rode `node scripts/build-brand-assets.mjs` (o `static_files` do Supabase é descartado no deploy sem Docker, por isso base64).

**Gerencial:** no detalhe do relatório: "Abrir PDF" (signed URL de 60 s pela policy `relatorio_sessao.read`), "Copiar link" (o mesmo do WhatsApp), contador de aberturas e "Regerar e reenviar" (`regenerate: true` refaz texto e PDF).

## Trilha de Olhares (1º, 2º, 3º…)

Cada criança tem uma sequência de Olhares e cada um é diferente do anterior:

| Tipo | Quando | Conteúdo |
|---|---|---|
| ESTREIA | 1º | Retrato completo + caixa "Sua trilha de Olhares" |
| CONTINUIDADE | demais | Faixa da trilha, "Novidades desde a última visita" (só positivas) e 1 área em destaque com prosa; as outras áreas só com marcadores |
| MARCO | 3º, 5º, 10º, 15º… | Tudo da CONTINUIDADE + página "Retrospectiva" (conquistas por área, linha das visitas, brincadeiras exploradas) |

- Regras puras em `packages/domain/src/session-report/trail.ts` (cópia Deno em `_shared/sessionReportTrail.ts`; o teste `olhar-trail.spec.ts` confere).
- O nº e o tipo ficam gravados na 1ª geração (`olhar_seq`, `olhar_edition`); regerar não renumera.
- Blindagem: o painel só soma momentos "fez com autonomia" (nunca cai), sem nota/média/percentual, com legenda fixa dizendo que não mede desempenho nem é indicador clínico/escolar.
- Deploy: aplicar `20261001130000_fa_olhar_trail.sql` **antes** de publicar `session-report-dispatch` (o dispatch passa `p_olhar_seq`/`p_olhar_edition` ao RPC).
