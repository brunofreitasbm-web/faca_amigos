# Especificações Técnicas e Arquiteturais do Sistema FaçaAmigos

**Documento de Especificação do Sistema de Gestão, PDV e Gerencial — FaçaAmigos**  
**Data:** Agosto de 2026  
**Versão:** 2.0  
**Operação:** Playground Inclusivo e Espaço de Socialização Infantil (Belém/PA)

---

## 1. Visão Geral do Sistema e Conceito do Negócio

O **FaçaAmigos** é um sistema completo de gestão operacional, ponto eletrônico, controle de caixa (PDV), faturamento fiscal e administração gerencial desenvolvido para apoiar operações de playgrounds inclusivos em unidades de shoppings.

### Principais Pilares da Aplicação:
- **Inclusão & Experiência Segura:** Registro de tags sensoriais, preferências de acolhimento e alertas de cuidados específicos para crianças neurodivergentes (TEA, TDAH, T21).
- **Operação Offline-First:** Garantia de funcionamento ininterrupto no balcão mesmo em caso de oscilações na conexão de internet.
- **Arquitetura Unificada:** Eliminação de sistemas legados separados em prol de uma **SPA (Single Page Application)** única que combina o quiosque/balcão e o Módulo Gerencial Admin.

---

## 2. Arquitetura de Software e Stack Tecnológica

O projeto é estruturado em um **Monorepo** gerenciado com **pnpm workspaces** e **Turborepo**.

```
faca_amigos/
├── apps/
├── packages/
│   ├── ui/             # Design System unificado (tokens CSS, componentes React)
│   ├── domain/         # Regras de negócio de precificação, VIP, tempo e formato
│   ├── fiscal/         # Motor de emissão e contingência de NFC-e
│   └── db-local/       # Persistência offline local (SQLite/Embedded)
├── supabase/           # Migrations SQL, RPCs PL/pgSQL e políticas RLS
└── ESPECIFICACOES_SISTEMA.md
```

### Tecnologias Utilizadas:
- **Core / UI:** React 19 + TypeScript + Vite (`apps/kiosk-ui`).
- **Estilização:** CSS Vanilla com Design System customizado (`@facaamigos/ui`), suporte a temas, sombras suaves e componentes acessíveis.
- **Backend em Nuvem:** Supabase PostgreSQL com Row Level Security (RLS) habilitado em 100% das tabelas.
- **Autenticação e Autorização:** Autenticação local por PIN de 6 dígitos e Controle de Acesso Baseado em Capacidades (RBAC).
- **Impressão Térmica:** Motor ESC/POS para cupons de check-in, etiquetas de pulseiras e comprovantes de ponto.

---

## 3. Módulos do Sistema

### 3.1. Seletor de Módulo e Dashboard Inicial
- Permite ao operador selecionar a unidade de atuação (Loja ou Quiosque) para o dia de trabalho.
- Oferece acesso restrito ao **Módulo Gerencial** para Administradores/Owners.

### 3.2. Módulo de Vendas e PDV (Operação de Balcão)
- **Check-in & Sessões:** Registro do responsável (CPF, telefone) e da criança, vinculação de pulseira por QR Code/código e seleção de plano (Playground ou Carrinho).
- **Painel de Acompanhamento (Tempo Real):** Monitoramento visual das crianças no brinquedo, cálculo automático de tempo excedente e alertas visuais de estouro de tolerância.
- **Venda de Produtos:** Catálogo de vendas avulsas (meias antiderrapantes, bebidas, souvenires) com abatimento automático de estoque.
- **Pagamentos:** Suporte a Dinheiro, PIX, Cartões de Crédito/Débito e Vouchers.
- **Controle de Caixa:** Abertura, suprimento, sangria, conferência cega e fechamento de turno por operador.
  - **Fechamento:** além do total vendido por forma de pagamento, o operador informa o **dinheiro total contado na gaveta** (comparado ao calculado: fundo inicial + faturamento em dinheiro ± movimentações, apurando quebra/sobra) e o **fundo de caixa para o próximo dia**. O **valor do envelope** é calculado (contado − fundo do próximo dia) e precisa ser registrado com número e foto antes de concluir.
  - **Abertura:** o fundo contado na abertura é conciliado com o fundo declarado no último fechamento da unidade; qualquer divergência gera alerta (push + e-mail) para o Owner e fica registrada no turno e na auditoria.
- **Emissão Fiscal (NFC-e):** Integração com SEFAZ/PA para emissão automática de Nota Fiscal ao Consumidor Eletrônica.

### 3.3. Módulo de Ponto Eletrônico de Colaboradores
- **Marcação Imutável:** Registro de entradas, saídas e intervalos por PIN do colaborador com geração de NSR (Número Sequencial de Registro).
- **Relatórios Gerenciais:** Espelho de Ponto mensal para conferência e assinatura física.

### 3.4. Módulo Gerencial (Macro Management)
Centralizado na interface do quiosque sob a aba **Gerencial**, acessível por administradores com capacidade `config.write`:

1. **Planos de Preços:** Cadastro de planos de tempo (30 min, 50 min, 1h, etc.) e valores por unidade, com regra de cobrança proporcional de minutos excedentes.
2. **Pacotes & Upgrade VIP:** Gestão de pacotes de minutos recorrentes para clientes assíduos.
3. **Catálogo de Produtos:** Cadastro unificado de produtos e alocação de estoque por loja.
4. **Cupons de Desconto:** Criação de cupons promocionais ou parcerias comerciais com limite de usos.
5. **Fidelidade:** Regras automatizadas de recompensas por retorno/número de visitas da família.
6. **Metas da Equipe:** Configuração de metas de faturamento diárias e bonificação da equipe de mediadores.
7. **Gestão de Colaboradores:** Cadastro unificado da equipe, atribuição de unidades de atuação (`fa_kiosk_employee_units`) e controle de perfil (`OPERADOR`, `GERENTE`, `ADMIN`).
8. **Folha de Pagamento (Payroll):**
   - Extrato mensal automatizado integrando horas trabalhadas via ponto eletrônico, salários-base e proventos/descontos.
   - Fechamento mensal atômico (`fa_kiosk_close_payroll_run`) com preservação histórica imutável dos valores e dados dos colaboradores no momento do fechamento.
   - Exportação de relatórios bancários em CSV formatados para conferência e envio ao **Bradesco Net Empresa (Multipag)**.
9. **Relatórios Agregados:** Consolidação de vendas, ticket médio, visitas e mapa de calor do uso de frotas de carrinhos entre todas as unidades.

---

## 4. API de Integração com Shoppings (Faturamento)

Interface de integração segura para envio automatizado de declarações de faturamento à administração do shopping.

- **Protocolo:** HTTPS · REST · JSON (ou CSV).
- **Autenticação:** Chave de API estática via cabeçalho `Authorization: Bearer fa_shp_...` ou `X-API-Key`.
- **Escopo:** `FATURAMENTO_LEITURA` (restrito a dados agregados por dia).
- **Endpoints:**
  - `GET /integracao/shopping/v1/health` (Health Check da credencial).
  - `GET /integracao/shopping/v1/faturamento?de=AAAA-MM-DD&ate=AAAA-MM-DD` (Consulta de receita bruta, descontos, receita líquida, vendas por meio de pagamento e por natureza do serviço).
- **Privacidade & LGPD:** Transmite estritamente valores consolidados por dia; nenhum dado pessoal de crianças, responsáveis ou funcionários é exposto.

---

## 5. Segurança, Banco de Dados e Permissões (RBAC)

- **Segurança de Dados Sensíveis:** Separação estrita de credenciais (`fa_kiosk_local_credentials`) e dados bancários de colaboradores (`fa_kiosk_employee_payroll_info`) em tabelas isoladas com políticas RLS restritas apenas a administradores (`folha_pagamento.read`/`write`).
- **RLS (Row Level Security):** Todas as tabelas do banco Supabase possuem políticas ativas que impedem o vazamento de dados entre unidades ou acessos não autorizados.
- **Funções de Banco (RPC):** Operações críticas como fechamento de folha de pagamento e check-in de sessões utilizam funções `SECURITY DEFINER` escritas em PL/pgSQL para garantir atomicidade.

---

## 6. Considerações de Manutenção e Evolução

- **Ambiente de Desenvolvimento:** Padrão de código limpo em TypeScript, sem o uso de fallbacks arbitrários ou supressão de erros de compilação.
- **Diretriz DEV_LEIGO:** Qualquer evolução funcional no sistema deve seguir o processo de direcionamento técnico estruturado em solicitações simples e objetivas.
