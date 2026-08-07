import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Tag, HelpText, AsyncState } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry, AuthorizedGuardian } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { formatCpf, formatPhoneBr } from "@facaamigos/domain";
import { money } from "../format.js";

const DOCUMENT_KINDS = [
  { value: "RG", label: "RG" },
  { value: "CNH", label: "CNH" },
  { value: "PASSAPORTE", label: "Passaporte" },
  { value: "CTPS_DIGITAL", label: "Documento digital (gov.br / CTPS)" },
  { value: "OUTRO", label: "Outro documento com foto" },
];

const OTHER = "__OUTRO__";

/**
 * Saída de contingência — recibo perdido ou etiqueta danificada.
 *
 * Aqui não há QR para ler, então o que substitui a prova física é a
 * conferência do documento com foto de quem veio buscar, feita pelo
 * operador contra o cadastro. O papel deste diálogo é garantir que essa
 * conferência aconteça na ordem certa e deixe rastro:
 *
 *   1. mostra QUEM está autorizado a retirar esta criança, com CPF, para o
 *      operador comparar com o documento na mão;
 *   2. exige que ele diga qual documento conferiu;
 *   3. registra a liberação em fa_kiosk_session_events, com o colaborador
 *      autenticado como autor (forçado por trigger no banco).
 *
 * Retirada por quem não está no cadastro não é bloqueada: no balcão real
 * isso acontece (avó, tia, motorista da família) e travar a saída de uma
 * criança por regra de software cria um problema pior do que resolve. Mas
 * passa a exigir justificativa escrita e fica marcada como exceção.
 */
export function SaidaManualModal({
  entry,
  onClose,
  onAuthorized,
}: {
  entry: ActiveSessionEntry;
  onClose: () => void;
  onAuthorized: () => void;
}) {
  const { employee } = useAppState();
  const [guardians, setGuardians] = useState<AuthorizedGuardian[] | null>(null);
  const [guardianId, setGuardianId] = useState<string>("");
  const [documentKind, setDocumentKind] = useState("RG");
  const [documentNote, setDocumentNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Api.saidaResponsaveis(entry.session.id)
      .then((rows) => {
        if (!active) return;
        setGuardians(rows);
        // Pré-seleciona o responsável principal: é quem retira na maioria
        // esmagadora dos casos, e ainda assim exige a conferência abaixo.
        setGuardianId(rows.find((g) => g.isPrimary)?.guardianId ?? "");
      })
      .catch(() => active && setGuardians([]));
    return () => {
      active = false;
    };
  }, [entry.session.id]);

  const isThirdParty = guardianId === OTHER || guardianId === "";
  const canConfirm = Boolean(employee) && Boolean(documentKind) && (!isThirdParty || reason.trim().length >= 3);

  async function confirm() {
    if (!employee || !canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await Api.saidaManualAuthorize({
        sessionId: entry.session.id,
        guardianId: isThirdParty ? null : guardianId,
        documentKind,
        documentNote: documentNote.trim() || undefined,
        reason: reason.trim() || undefined,
        employeeId: employee.id,
      });
      onAuthorized();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível registrar a liberação.";
      setError(
        msg.includes("JUSTIFICATIVA_OBRIGATORIA")
          ? "Descreva quem está retirando a criança e por quê."
          : msg.includes("DOCUMENTO_OBRIGATORIO")
            ? "Informe qual documento foi conferido."
            : msg.includes("SESSAO_JA_FECHADA")
              ? "Esta sessão já foi fechada em outro dispositivo."
              : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Saída manual — conferência de documento" onClose={onClose} maxWidth="480px" zIndex={170} closeOnBackdrop={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ padding: "12px 14px", borderRadius: "12px", background: "var(--surface-sunken)" }}>
          <strong style={{ fontSize: "18px", display: "block" }}>{entry.session.child_name_snapshot}</strong>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {entry.plan.name} · a pagar {money(entry.quote.totalCents)}
          </span>
        </div>

        <HelpText>
          Use este caminho só quando o recibo foi perdido <strong>e</strong> a pulseira não pode ser lida. Confira o
          documento com foto de quem está retirando contra a lista abaixo antes de liberar.
        </HelpText>

        {guardians === null ? (
          <AsyncState kind="loading" title="Carregando responsáveis cadastrados…" />
        ) : (
          <>
            <div>
              <Select
                label="Quem está retirando a criança"
                value={guardianId}
                onChange={(e) => setGuardianId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {guardians.map((g) => (
                  <option key={g.guardianId} value={g.guardianId}>
                    {g.fullName}
                    {g.cpf ? ` — CPF ${formatCpf(g.cpf)}` : ""}
                    {g.isPrimary ? " (responsável da entrada)" : ""}
                  </option>
                ))}
                <option value={OTHER}>Outra pessoa (não cadastrada)</option>
              </Select>

              {/* Os dados completos ficam à vista para a conferência, não
                  escondidos dentro do <select>. */}
              {guardians.length > 0 && (
                <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none", fontSize: "12px", color: "var(--text-muted)" }}>
                  {guardians.map((g) => (
                    <li key={g.guardianId}>
                      • {g.fullName}
                      {g.cpf ? ` · CPF ${formatCpf(g.cpf)}` : " · sem CPF cadastrado"}
                      {g.phone ? ` · ${formatPhoneBr(g.phone)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Select label="Documento conferido" value={documentKind} onChange={(e) => setDocumentKind(e.target.value)}>
              {DOCUMENT_KINDS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>

            <Input
              label="Identificação do documento (opcional)"
              placeholder="Ex.: RG 1234567 SSP/PA"
              value={documentNote}
              onChange={(e) => setDocumentNote(e.target.value)}
            />

            {isThirdParty && (
              <>
                <Tag color="var(--color-amber)">
                  Retirada por pessoa não cadastrada — será registrada como exceção
                </Tag>
                <Input
                  label="Quem é e por que está retirando"
                  placeholder="Ex.: avó materna, autorizada por telefone pela mãe"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </>
            )}
          </>
        )}

        {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={confirm}
            loading={busy}
            disabled={busy || !canConfirm || guardians === null}
            title="Registrar a conferência e seguir para o pagamento"
          >
            Conferi — ir para o pagamento
          </Button>
        </div>
      </div>
    </Modal>
  );
}
