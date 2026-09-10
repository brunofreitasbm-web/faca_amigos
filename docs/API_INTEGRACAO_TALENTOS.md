# Documentação da API de Integração — Banco de Talentos

Esta API permite que sistemas externos (CRMs, Painéis de RH, n8n, Make, Zapier ou aplicações próprias) consultem e atualizem informações dos candidatos cadastrados no Banco de Talentos do **Faça Amigos**.

---

## 🔑 Autenticação

Todas as requisições devem enviar uma chave de acesso no cabeçalho (*Header*):

```http
x-api-key: SUA_CHAVE_DE_INTEGRACAO
```
*Observação: A chave é configurada nas variáveis de ambiente do servidor (`TALENT_API_KEY` ou `WEBHOOK_SECRET`).*

---

## 📡 Endpoints Disponíveis

### 1. Listar Candidatos (GET)

Retorna a lista de candidatos com suporte a filtros, paginação e links seguros temporários (válidos por 24h) para download do currículo PDF.

- **URL:** `https://<seu-projeto>.supabase.co/functions/v1/export-job-applications`
- **Método:** `GET`
- **Parâmetros de Busca (Query Params):**
  - `status` *(Opcional)*: `NOVO`, `EM_ANALISE`, `ENTREVISTA`, `CONTATADO`, `ARQUIVADO`, `TODOS`.
  - `limit` *(Opcional)*: Número de registros (Padrão: `50`).
  - `offset` *(Opcional)*: Registro inicial para paginação (Padrão: `0`).

#### Exemplo de Requisição (cURL):
```bash
curl -X GET "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/export-job-applications?status=NOVO&limit=20" \
  -H "x-api-key: SUA_CHAVE_DE_INTEGRACAO"
```

#### Exemplo de Resposta (JSON):
```json
{
  "success": true,
  "total": 1,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "full_name": "Juliana Silva Santos",
      "email": "juliana.santos@email.com",
      "phone": "91984123456",
      "course": "Administração",
      "desired_area": "VENDAS",
      "opportunity_type": "REMUNERADO",
      "status": "NOVO",
      "created_at_ms": 1726000000000,
      "created_at_iso": "2026-09-10T15:00:00.000Z",
      "resume_url": "https://<supabase-url>/storage/v1/object/sign/curriculos/..."
    }
  ]
}
```

---

### 2. Atualizar Status do Candidato (POST / PATCH)

Permite que o sistema externo atualize o estágio do candidato no processo seletivo.

- **URL:** `https://<seu-projeto>.supabase.co/functions/v1/export-job-applications`
- **Método:** `POST` ou `PATCH`
- **Body (JSON):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "ENTREVISTA"
}
```

#### Status Válidos:
- `NOVO`: Candidato recém-chegado.
- `LIDO`: Currículo visualizado.
- `EM_ANALISE`: Em triagem.
- `ENTREVISTA`: Agendado para entrevista.
- `CONTATADO`: Contato efetuado.
- `ARQUIVADO`: Encerrado/Banco de reserva.

---

## ⚡ Webhook de Entrada (Recebimento de Novos Candidatos)

Para enviar candidatos de um formulário externo para o Banco de Talentos:

- **URL:** `https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/job-application-webhook`
- **Método:** `POST`
- **Formato:** `multipart/form-data`
- **Campos:**
  - `full_name`: Nome do candidato
  - `email`: E-mail
  - `phone`: Telefone/WhatsApp com DDD
  - `desired_area`: Área/Vaga (`VENDAS`, `RECEPCAO`, `MONITORIA`, etc.)
  - `opportunity_type`: `REMUNERADO`, `ESTAGIO` ou `BOLSA`
  - `resume`: Arquivo PDF (máx. 5MB)
