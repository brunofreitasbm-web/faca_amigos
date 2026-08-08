import { useEffect, useState } from "react";
import { Button, Card, HelpText, Input, Modal, Select, Tag } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Employee, PersonalInfoStatus } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { ROLE_LABEL, ROLE_DESCRIPTION, FUNCTION_OPTIONS } from "../../../auth/capabilities.js";
import { EspelhoPontoModal } from "../../../components/EspelhoPontoModal.js";
import { UnitCheckboxGroup } from "../UnitCheckboxGroup.js";

export function ColaboradoresTab() {
  const toast = useToast();
  const { can } = useAuth();
  const { units } = useAppState();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cadastroStatus, setCadastroStatus] = useState<Map<string, boolean>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [espelhoTarget, setEspelhoTarget] = useState<Employee | null>(null);

  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [functionKey, setFunctionKey] = useState<string>(FUNCTION_OPTIONS[0]!.value);
  const [contractType, setContractType] = useState<NonNullable<Employee["contract_type"]>>("CLT");
  const [weeklyHours, setWeeklyHours] = useState("44");
  const [unitIds, setUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFunction = FUNCTION_OPTIONS.find((f) => f.value === functionKey) ?? FUNCTION_OPTIONS[0]!;

  const [resetPinTarget, setResetPinTarget] = useState<Employee | null>(null);
  const [newPin, setNewPin] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [unitsTarget, setUnitsTarget] = useState<Employee | null>(null);
  const [unitsTargetIds, setUnitsTargetIds] = useState<string[]>([]);
  const [unitsBusy, setUnitsBusy] = useState(false);

  // Link de convite individual: o Owner decide função/cargo/unidade(s)/
  // admissão aqui — quem preenche o convite depois só completa os próprios
  // dados pessoais, nunca escolhe o próprio nível de acesso.
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFunctionKey, setInviteFunctionKey] = useState<string>(FUNCTION_OPTIONS[0]!.value);
  const [inviteUnitIds, setInviteUnitIds] = useState<string[]>(units.map((u) => u.id));
  const [inviteFullNameHint, setInviteFullNameHint] = useState("");
  const [inviteAdmissionDate, setInviteAdmissionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const inviteSelectedFunction = FUNCTION_OPTIONS.find((f) => f.value === inviteFunctionKey) ?? FUNCTION_OPTIONS[0]!;

  function closeInviteModal() {
    setShowInviteModal(false);
    setInviteFunctionKey(FUNCTION_OPTIONS[0]!.value);
    setInviteUnitIds(units.map((u) => u.id));
    setInviteFullNameHint("");
    setInviteAdmissionDate(new Date().toISOString().slice(0, 10));
    setInviteError(null);
    setInviteLink(null);
  }

  async function generateInvite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const { inviteId, token } = await Api.createOnboardingInvite({
        role: inviteSelectedFunction.role,
        position: inviteSelectedFunction.label,
        unitIds: inviteUnitIds,
        fullNameHint: inviteFullNameHint.trim() || undefined,
        admissionDate: inviteAdmissionDate || undefined,
      });
      setInviteLink(`${window.location.origin}${window.location.pathname}?convite=${inviteId}.${token}`);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Não foi possível gerar o convite");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    toast.success("Link copiado.");
  }

  function load() {
    Api.allEmployees().then(setEmployees);
    // Quem já completou o auto-cadastro de RH (módulo "Cadastro de
    // Colaboradores") — só pra sinalizar quem o RH ainda precisa cobrar,
    // não expõe o conteúdo dos dados aqui.
    Api.personalInfoStatus()
      .then((rows: PersonalInfoStatus[]) => setCadastroStatus(new Map(rows.map((r) => [r.employeeId, r.completed]))))
      .catch(() => setCadastroStatus(new Map()));
  }
  useEffect(load, []);
  useEffect(() => setUnitIds(units.map((u) => u.id)), [units]);

  function resetForm() {
    setFullName("");
    setCpf("");
    setEmail("");
    setPhone("");
    setPin("");
    setBirthDate("");
    setAdmissionDate("");
    setFunctionKey(FUNCTION_OPTIONS[0]!.value);
    setContractType("CLT");
    setWeeklyHours("44");
    setShowOptionalFields(false);
    setUnitIds(units.map((u) => u.id));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await Api.createEmployee({
        fullName: fullName.trim(),
        role: selectedFunction.role,
        cpf: cpfDigits ? cpfDigits : undefined,
        email: email.trim() ? email.trim() : undefined,
        phone: phoneDigits ? phoneDigits : undefined,
        pin,
        birthDate: birthDate || undefined,
        admissionDate: admissionDate || undefined,
        position: selectedFunction.label,
        contractType,
        weeklyHoursContracted: Number(weeklyHours) || 44,
      });
      // Grava a atribuição de unidade(s) na mesma ação, para não deixar um
      // colaborador "sem unidade" entre o cadastro e um segundo passo.
      if (unitIds.length > 0) {
        await Api.setEmployeeUnits(created.id, unitIds);
      }
      toast.success("Colaborador criado — já pode entrar com o PIN definido.");
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar colaborador");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(emp: Employee) {
    try {
      await Api.setEmployeeActive(emp.id, !emp.active);
      toast.success(`${emp.full_name} foi ${emp.active ? "desativado(a)" : "reativado(a)"}.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar o colaborador");
    }
  }

  async function changeRole(emp: Employee, next: Employee["role"]) {
    if (next === emp.role) return;
    try {
      await Api.setEmployeeRole(emp.id, next);
      toast.success(`${emp.full_name} agora é ${ROLE_LABEL[next]}.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar o nível de acesso");
      load();
    }
  }

  function closeResetPin() {
    setResetPinTarget(null);
    setNewPin("");
    setResetError(null);
  }

  async function confirmResetPin() {
    if (!resetPinTarget) return;
    setResetBusy(true);
    setResetError(null);
    try {
      await Api.setEmployeePin(resetPinTarget.id, newPin);
      toast.success(`PIN de ${resetPinTarget.full_name} redefinido.`);
      closeResetPin();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Não foi possível redefinir o PIN");
    } finally {
      setResetBusy(false);
    }
  }

  function openUnitsModal(emp: Employee) {
    setUnitsTarget(emp);
    setUnitsTargetIds(emp.unitIds ?? []);
  }

  async function confirmUnits() {
    if (!unitsTarget) return;
    setUnitsBusy(true);
    try {
      await Api.setEmployeeUnits(unitsTarget.id, unitsTargetIds);
      toast.success(`Unidades de ${unitsTarget.full_name} atualizadas.`);
      setUnitsTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível atualizar as unidades");
    } finally {
      setUnitsBusy(false);
    }
  }

  const cpfDigits = cpf.replace(/\D/g, "");
  const phoneDigits = phone.replace(/\D/g, "");
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const cpfValid = !cpf || cpfDigits.length === 11;
  const phoneValid = !phone || phoneDigits.length === 10 || phoneDigits.length === 11;

  const formValid = Boolean(fullName.trim().length >= 2 && pin.length === 6 && cpfValid && emailValid && phoneValid);

  return (
    <div>
      {!showForm && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>Equipe e Colaboradores</h2>
            <HelpText>{employees.length} colaboradores cadastrados, nas 3 unidades.</HelpText>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => setShowInviteModal(true)} style={{ borderRadius: "9999px" }}>
              🔗 Gerar link de cadastro
            </Button>
            <Button variant="primary" onClick={() => setShowForm(true)} style={{ borderRadius: "9999px" }}>
              ⚡ + Novo colaborador rápido
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <Card style={{ padding: "20px", marginBottom: "20px", borderRadius: "18px", border: "2px solid var(--color-primary, #f0196b)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>⚡ Cadastro Rápido de Colaborador</h2>
              <HelpText style={{ margin: 0 }}>Apenas Nome, Função e PIN são obrigatórios para cadastro imediato.</HelpText>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>
              ✕ Fechar
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <Input label="Nome completo *" placeholder="Ex: Maria Silva" value={fullName} onChange={(e) => setFullName(e.target.value)} />

              <Select label="Função e Permissão *" title={ROLE_DESCRIPTION[selectedFunction.role]} value={functionKey} onChange={(e) => setFunctionKey(e.target.value)}>
                {FUNCTION_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label} ({ROLE_LABEL[f.role]})
                  </option>
                ))}
              </Select>

              <Input
                label="PIN de Acesso (6 dígitos) *"
                placeholder="Ex: 123456"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                error={pin && pin.length !== 6 ? "PIN deve ter 6 dígitos" : undefined}
              />
            </div>

            <HelpText style={{ margin: 0 }}>
              Permissão concedida: <strong>{ROLE_LABEL[selectedFunction.role]}</strong> — {ROLE_DESCRIPTION[selectedFunction.role]}
            </HelpText>

            <UnitCheckboxGroup units={units} selected={unitIds} onChange={setUnitIds} />

            <div style={{ marginTop: "4px" }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowOptionalFields((v) => !v)}
                style={{ color: "var(--color-primary-hover)", fontWeight: "bold" }}
              >
                {showOptionalFields ? "− Ocultar dados complementares" : "＋ Adicionar dados complementares (CPF, E-mail, Telefone, Admissão — Opcional)"}
              </Button>

              {showOptionalFields && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginTop: "12px", padding: "14px", background: "var(--surface-sunken)", borderRadius: "14px" }}>
                  <Input label="CPF (Opcional)" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} error={cpf && !cpfValid ? "CPF precisa ter 11 dígitos" : undefined} />
                  <Input label="E-mail (Opcional)" type="email" placeholder="colaborador@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} error={email && !emailValid ? "E-mail inválido" : undefined} />
                  <Input label="Telefone com DDD (Opcional)" placeholder="(91) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} error={phone && !phoneValid ? "Telefone precisa ter 10 ou 11 dígitos" : undefined} />
                  <Input label="Data de nascimento (Opcional)" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                  <Input label="Data de admissão (Opcional)" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
                  <Select label="Tipo de contrato" value={contractType} onChange={(e) => setContractType(e.target.value as typeof contractType)}>
                    <option value="CLT">CLT</option>
                    <option value="ESTAGIO">Estágio</option>
                    <option value="AUTONOMO">Autônomo</option>
                  </Select>
                  <Input label="Jornada semanal (horas)" type="number" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} />
                </div>
              )}
            </div>

            {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <Button variant="primary" disabled={busy || !formValid} onClick={create} style={{ borderRadius: "9999px" }}>
                ✓ Cadastrar Colaborador
              </Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {resetPinTarget && (
        <Modal onClose={closeResetPin} title={`🔑 Redefinir PIN de ${resetPinTarget.full_name}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
              Informe o novo PIN numérico de 6 dígitos que o colaborador usará para login no sistema.
            </p>
            <Input
              label="Novo PIN (6 dígitos)"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              error={newPin && newPin.length !== 6 ? "PIN deve ter exatamente 6 dígitos" : undefined}
            />
            {resetError && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{resetError}</p>}
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <Button variant="primary" disabled={resetBusy || newPin.length !== 6} onClick={confirmResetPin} style={{ borderRadius: "9999px", flex: 1 }}>
                Salvar Novo PIN
              </Button>
              <Button variant="ghost" onClick={closeResetPin}>
                Cancelar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {unitsTarget && (
        <Modal onClose={() => setUnitsTarget(null)} title={`🗂️ Unidades de ${unitsTarget.full_name}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
              Em quais unidades este colaborador atua? Aparece na Configurações e no Ponto só das unidades marcadas.
            </p>
            <UnitCheckboxGroup units={units} selected={unitsTargetIds} onChange={setUnitsTargetIds} />
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <Button variant="primary" disabled={unitsBusy} onClick={confirmUnits} style={{ borderRadius: "9999px", flex: 1 }}>
                Salvar unidades
              </Button>
              <Button variant="ghost" onClick={() => setUnitsTarget(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showInviteModal && (
        <Modal onClose={closeInviteModal} title="🔗 Gerar link de cadastro">
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {!inviteLink ? (
              <>
                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
                  Escolha a função, unidade(s) e data de admissão — quem abrir o link só completa os próprios dados
                  pessoais e escolhe o PIN, sem poder alterar o nível de acesso.
                </p>
                <Select label="Função e Permissão *" title={ROLE_DESCRIPTION[inviteSelectedFunction.role]} value={inviteFunctionKey} onChange={(e) => setInviteFunctionKey(e.target.value)}>
                  {FUNCTION_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label} ({ROLE_LABEL[f.role]})
                    </option>
                  ))}
                </Select>
                <UnitCheckboxGroup units={units} selected={inviteUnitIds} onChange={setInviteUnitIds} />
                <Input label="Data de admissão" type="date" value={inviteAdmissionDate} onChange={(e) => setInviteAdmissionDate(e.target.value)} />
                <Input label="Nome (opcional, se já souber)" value={inviteFullNameHint} onChange={(e) => setInviteFullNameHint(e.target.value)} />
                {inviteError && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{inviteError}</p>}
                <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                  <Button variant="primary" disabled={inviteBusy || inviteUnitIds.length === 0} onClick={generateInvite} style={{ borderRadius: "9999px", flex: 1 }}>
                    {inviteBusy ? "Gerando…" : "Gerar link"}
                  </Button>
                  <Button variant="ghost" onClick={closeInviteModal}>
                    Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
                  Válido por 7 dias ou até a pessoa preencher — o que vier primeiro. Mande por um canal que só ela
                  tenha acesso (WhatsApp direto, por exemplo).
                </p>
                <Input label="Link de cadastro" value={inviteLink} readOnly onFocus={(e) => e.target.select()} />
                <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                  <Button variant="primary" onClick={copyInviteLink} style={{ borderRadius: "9999px", flex: 1 }}>
                    📋 Copiar link
                  </Button>
                  <Button variant="ghost" onClick={closeInviteModal}>
                    Fechar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {employees.map((e) => {
          const roleBadgeStyle =
            e.role === "ADMIN"
              ? { bg: "rgba(124, 58, 237, 0.12)", color: "#6d28d9", label: "👑 Admin" }
              : e.role === "GERENTE"
              ? { bg: "rgba(37, 99, 235, 0.12)", color: "#1d4ed8", label: "⭐ Gerente" }
              : { bg: "rgba(13, 148, 136, 0.12)", color: "#0f766e", label: "👤 Operador" };
          const employeeUnitNames = (e.unitIds ?? []).map((id) => units.find((u) => u.id === id)?.name).filter(Boolean);

          return (
            <Card
              key={e.id}
              style={{
                padding: "16px",
                borderRadius: "16px",
                opacity: e.active === false ? 0.6 : 1,
                border: e.active === false ? "1px dashed var(--border-subtle)" : "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "50%",
                      background: roleBadgeStyle.bg,
                      color: roleBadgeStyle.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold",
                      fontSize: "18px",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {e.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "16px" }}>{e.full_name}</strong>
                      <span style={{ fontSize: "12px", fontWeight: "bold", padding: "2px 8px", borderRadius: "9999px", background: roleBadgeStyle.bg, color: roleBadgeStyle.color }}>
                        {roleBadgeStyle.label}
                      </span>
                      {e.active === false ? <Tag color="var(--text-muted)">Inativo</Tag> : <Tag color="var(--color-teal, #1d9b84)">Ativo</Tag>}
                      {cadastroStatus.get(e.id) ? (
                        <Tag color="var(--color-teal, #1d9b84)">📋 Cadastro completo</Tag>
                      ) : (
                        <Tag color="var(--color-warning, #b45309)">⚠️ Cadastro pendente</Tag>
                      )}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {e.position || ROLE_LABEL[e.role]}
                      {e.cpf ? ` · CPF: ${e.cpf}` : ""}
                      {e.phone ? ` · Tel: ${e.phone}` : ""}
                      {e.admission_date ? ` · Admitido: ${new Date(e.admission_date).toLocaleDateString("pt-BR")}` : ""}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      🗂️ {employeeUnitNames.length > 0 ? employeeUnitNames.join(", ") : "sem unidade atribuída"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <Select
                    aria-label={`Nível de acesso de ${e.full_name}`}
                    title={ROLE_DESCRIPTION[e.role]}
                    value={e.role}
                    onChange={(ev) => void changeRole(e, ev.target.value as Employee["role"])}
                    style={{ minWidth: "120px", fontSize: "13px" }}
                  >
                    {(["OPERADOR", "GERENTE", "ADMIN"] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>

                  <Button variant="ghost" size="sm" onClick={() => openUnitsModal(e)} title="Definir em quais unidades este colaborador atua">
                    🗂️ Unidades
                  </Button>

                  <Button variant="ghost" size="sm" onClick={() => { setResetError(null); setResetPinTarget(e); }} title="Redefinir PIN de login">
                    🔑 PIN
                  </Button>

                  {can("relatorio.ponto") && (
                    <Button variant="ghost" size="sm" onClick={() => setEspelhoTarget(e)} title="Gerar e imprimir o espelho de ponto mensal deste colaborador">
                      📄 Ponto
                    </Button>
                  )}

                  <Button variant={e.active === false ? "secondary" : "ghost"} size="sm" onClick={() => toggleActive(e)} title={e.active === false ? "Ativar acesso do colaborador" : "Desativar acesso do colaborador"}>
                    {e.active === false ? "Reativar" : "Desativar"}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {espelhoTarget && <EspelhoPontoModal employee={espelhoTarget} onClose={() => setEspelhoTarget(null)} />}
    </div>
  );
}
