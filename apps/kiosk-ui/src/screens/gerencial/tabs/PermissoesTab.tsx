import { useEffect, useState } from "react";
import { Card, HelpText, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Employee } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";
import { RequireCapability } from "../../../auth/RequireCapability.js";
import { CAPABILITIES, CAPABILITY_LABEL, ROLE_LABEL } from "../../../auth/capabilities.js";

type EditableRole = Extract<Employee["role"], "OPERADOR" | "GERENTE" | "ADMIN">;

const EDITABLE_ROLES: EditableRole[] = ["OPERADOR", "GERENTE", "ADMIN"];

// Agrupamento só visual, pelo prefixo antes do primeiro ponto — não existe
// no banco, é puramente para a lista de 20+ capacidades não virar uma
// parede de texto.
const GROUP_LABEL: Record<string, string> = {
  sessao: "Sessões",
  pdv: "PDV / Vendas",
  venda: "Vendas",
  caixa: "Caixa",
  desconto: "Descontos",
  ponto: "Ponto",
  relatorio: "Relatórios",
  config: "Configurações",
  talentos: "Banco de Talentos",
};

function groupOf(capability: string): string {
  return GROUP_LABEL[capability.split(".")[0]!] ?? capability;
}

function PermissoesTabInner() {
  const toast = useToast();
  const [matrix, setMatrix] = useState<Record<string, EditableRole>>({});
  const [loading, setLoading] = useState(true);
  const [savingCapability, setSavingCapability] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Api.roleCapabilities()
      .then((rows) => {
        const next: Record<string, EditableRole> = {};
        for (const row of rows) {
          if (EDITABLE_ROLES.includes(row.role as EditableRole)) {
            next[row.capability] = row.role as EditableRole;
          }
        }
        setMatrix(next);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Não foi possível carregar as permissões"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function changeRole(capability: string, role: EditableRole) {
    const previous = matrix[capability];
    setMatrix((m) => ({ ...m, [capability]: role }));
    setSavingCapability(capability);
    try {
      await Api.setCapabilityRole(capability, role);
      const label = CAPABILITY_LABEL[capability as keyof typeof CAPABILITY_LABEL] ?? capability;
      toast.success(`"${label}" agora exige ${ROLE_LABEL[role]}.`);
    } catch (err) {
      setMatrix((m) => ({ ...m, [capability]: previous ?? m[capability]! }));
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar essa permissão");
    } finally {
      setSavingCapability(null);
    }
  }

  const groups = new Map<string, string[]>();
  for (const capability of CAPABILITIES) {
    // config.rbac.write não aparece na lista editável: é sempre Owner, e
    // deixar o Owner rebaixá-la por acidente removeria dele o acesso a
    // esta própria tela.
    if (capability === "config.rbac.write") continue;
    const g = groupOf(capability);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(capability);
  }

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>🔐 Permissões por Papel</h2>
        <HelpText>
          Para cada ação, escolha o nível mínimo de acesso que já pode fazê-la. Quem está acima na
          hierarquia (Operador → Líder → Owner) sempre herda tudo que os níveis abaixo podem — não é
          preciso marcar de novo para Líder e Owner.
        </HelpText>
      </Card>

      {loading ? (
        <Card style={{ padding: "20px" }}>
          <p style={{ color: "var(--text-muted)" }}>Carregando…</p>
        </Card>
      ) : (
        Array.from(groups.entries()).map(([group, caps]) => (
          <Card key={group} style={{ padding: "20px", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "15px", marginTop: 0, marginBottom: "12px" }}>{group}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {caps.map((capability) => {
                const role = matrix[capability];
                return (
                  <div
                    key={capability}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "16px",
                      flexWrap: "wrap",
                      opacity: savingCapability === capability ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontSize: "14px", flex: "1 1 260px" }}>
                      {CAPABILITY_LABEL[capability as keyof typeof CAPABILITY_LABEL] ?? capability}
                    </span>
                    <Select
                      value={role ?? "OPERADOR"}
                      disabled={!role || savingCapability === capability}
                      onChange={(e) => changeRole(capability, e.target.value as EditableRole)}
                      style={{ width: "160px" }}
                    >
                      {EDITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

export function PermissoesTab() {
  return (
    <RequireCapability capability="config.rbac.write">
      <PermissoesTabInner />
    </RequireCapability>
  );
}
