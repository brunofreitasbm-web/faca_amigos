import { useEffect, useState, useRef } from "react";
import { Button, Card, Modal, HelpText, Tabs } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee, PontoRecord } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { EmployeeAuthGate } from "../components/EmployeeAuthGate.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";
import { PunchPhotoCapture } from "../components/PunchPhotoCapture.js";
import { useFaceCapture } from "../hooks/useFaceCapture.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { isSameFace, findBestFaceMatch, playSuccessChime } from "../lib/faceRecognition.js";

const KINDS = [
  { value: "ENTRADA", label: "Entrada", help: "Registrar chegada / início de jornada" },
  { value: "INTERVALO_INICIO", label: "Almoço", help: "Registrar saída para intervalo / almoço" },
  { value: "INTERVALO_FIM", label: "Retorno", help: "Registrar retorno do intervalo / almoço" },
  { value: "SAIDA", label: "Saída", help: "Registrar término da jornada de trabalho" },
] as const;

const PJ_KINDS = [
  { value: "ENTRADA", label: "Início da Prestação", help: "Registrar chegada / início das atividades prestadas" },
  { value: "INTERVALO_INICIO", label: "Pausa", help: "Registrar início de intervalo / pausa na prestação" },
  { value: "INTERVALO_FIM", label: "Retorno da Pausa", help: "Registrar retorno das atividades prestadas" },
  { value: "SAIDA", label: "Término da Prestação", help: "Registrar término das atividades prestadas no dia" },
] as const;

function IconEntrada({ size = 28, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M13 3v18l7-3V6l-7-3z" fill={color} fillOpacity="0.12" />
      <path d="M2 12h9" />
      <path d="m8 9 3 3-3 3" />
    </svg>
  );
}

function IconAlmoco({ size = 28, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2v8a2 2 0 0 0 4 0V2" />
      <path d="M9 10v12" />
      <path d="M9 2v4" />
      <path d="M16 2v20" />
      <path d="M16 2c3 0 4 3 4 8v2h-4" fill={color} fillOpacity="0.15" />
    </svg>
  );
}

function IconRetorno({ size = 28, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11.5a4.5 4.5 0 0 1 4.5 4.5v0a4.5 4.5 0 0 1-4.5 4.5H11" />
    </svg>
  );
}

function IconSaida({ size = 28, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M13 3v18l7-3V6l-7-3z" fill={color} fillOpacity="0.12" />
      <path d="M11 12h10" />
      <path d="m18 9 3 3-3 3" />
    </svg>
  );
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getNextLogicalKind(todayPunches: PontoRecord[]): (typeof KINDS)[number]["value"] {
  if (!todayPunches || todayPunches.length === 0) return "ENTRADA";
  const last = todayPunches[todayPunches.length - 1];
  if (!last) return "ENTRADA";
  if (last.kind === "ENTRADA") return "INTERVALO_INICIO";
  if (last.kind === "INTERVALO_INICIO") return "INTERVALO_FIM";
  if (last.kind === "INTERVALO_FIM") return "SAIDA";
  return "ENTRADA";
}

/**
 * Bater ponto / Controle de Frequência para Estagiários e Colaboradores.
 * Suporta Modo Reconhecimento Facial Rápido (Touchless) e Fallback por PIN.
 * Registra instantaneamente com envio direto para a Folha de Ponto.
 */
export function PontoScreen() {
  const { unit, employee, hasFaceEnrolled } = useAppState();
  const isPj = employee?.role === "PRESTADOR_PJ" || employee?.contract_type === "PJ";
  const isEstagiario = employee?.role === "ESTAGIARIO";
  const screenTitle = isPj
    ? "Registro de Prestação de Serviço"
    : isEstagiario
    ? "Controle de Frequência"
    : "Bater ponto";
  const toast = useToast();

  const [mode, setMode] = useState<"FACIAL_RAPIDO" | "PIN_MANUAL">("FACIAL_RAPIDO");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [enrolledFaceList, setEnrolledFaceList] = useState<{ id: string; full_name: string; role: string; face_descriptor: number[] }[]>([]);

  const [selected, setSelected] = useState<Employee | null>(null);
  const [authedAs, setAuthedAs] = useState<TerminalEmployee | null>(null);
  const [today, setToday] = useState<PontoRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [myDescriptor, setMyDescriptor] = useState<number[] | null>(null);

  const [selectedKind, setSelectedKind] = useState<(typeof KINDS)[number]["value"] | null>(null);

  // Status de escaneamento facial rápido
  const [scanState, setScanState] = useState<"idle" | "scanning" | "detected" | "success" | "fail">("idle");
  const [detectedName, setDetectedName] = useState<string | null>(null);
  const [autoPunchResult, setAutoPunchResult] = useState<{
    fullName: string;
    role: string;
    kind: string;
    atMs: number;
    nsr: number;
  } | null>(null);
  const [punchSuccessModal, setPunchSuccessModal] = useState<{
    fullName: string;
    role: string;
    kind: string;
    atMs: number;
    nsr: number;
  } | null>(null);

  const faceCapture = useFaceCapture();
  const geolocation = useGeolocation();
  const geofenceRadiusM = unit?.geofence_radius_m ?? null;

  const isScanningRef = useRef(false);

  const isCurrentEmployeeBiometricEnrolled =
    hasFaceEnrolled === true || (!!employee && enrolledFaceList.some((e) => e.id === employee.id));

  useEffect(() => {
    if (isCurrentEmployeeBiometricEnrolled && mode === "PIN_MANUAL") {
      setMode("FACIAL_RAPIDO");
    }
  }, [isCurrentEmployeeBiometricEnrolled, mode]);

  useEffect(() => {
    Api.employees(unit?.id).then(setEmployees);
    Api.allEnrolledFaceDescriptors(unit?.id).then(setEnrolledFaceList).catch(() => setEnrolledFaceList([]));
  }, [unit?.id]);

  // Liga a câmera automaticamente quando no modo FACIAL_RAPIDO
  useEffect(() => {
    if (mode === "FACIAL_RAPIDO") {
      faceCapture.start();
      setScanState("scanning");
    } else if (!authedAs) {
      faceCapture.stop();
      setScanState("idle");
    }
    return () => {
      if (mode === "FACIAL_RAPIDO" && !authedAs) {
        faceCapture.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!authedAs) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    Api.pontoHistory(authedAs.id, startOfDay.getTime(), Date.now()).then(setToday);
  }, [authedAs, message]);

  useEffect(() => {
    if (!authedAs) return;
    faceCapture.start();
    Api.myFaceDescriptor(authedAs.id)
      .then(setMyDescriptor)
      .catch(() => setMyDescriptor(null));
    if (geofenceRadiusM !== null) geolocation.request();
    return () => faceCapture.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedAs?.id]);

  // Escaneamento facial instantâneo/rápido
  async function handleAutoScan() {
    if (isScanningRef.current || busy || scanState === "success" || !faceCapture.ready) return;
    isScanningRef.current = true;
    try {
      const captured = await faceCapture.capture();
      if (!captured || !captured.descriptor) {
        toast.error("Rosto não enquadrado. Por favor centralize a face na moldura.");
        return;
      }

      const candidates = enrolledFaceList.map((e) => ({
        id: e.id,
        descriptor: e.face_descriptor,
        full_name: e.full_name,
        role: e.role,
      }));

      const matchResult = findBestFaceMatch(captured.descriptor, candidates);
      if (matchResult) {
        const empMatch = matchResult.match;
        setScanState("detected");
        setDetectedName(empMatch.full_name);
        playSuccessChime();

        await executeAutoPunch(empMatch, captured.photo);
      } else {
        setScanState("fail");
        toast.error("Rosto não cadastrado ou não reconhecido. Cadastre a biometria ou use o PIN.");
        setTimeout(() => setScanState("scanning"), 3000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível processar o reconhecimento facial.");
    } finally {
      isScanningRef.current = false;
    }
  }

  async function executeAutoPunch(
    empMatch: { id: string; full_name: string; role: string },
    photo: Blob,
  ) {
    if (busy || !unit) return;
    setBusy(true);
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const userTodayPunches = await Api.pontoHistory(empMatch.id, startOfDay.getTime(), Date.now());
      const targetKind = selectedKind ?? getNextLogicalKind(userTodayPunches);

      const punchPhotoPath = await Api.uploadPontoFoto(empMatch.id, photo, "punch");

      let lat: number | null = null;
      let lng: number | null = null;
      if (geofenceRadiusM !== null) {
        const pos = geolocation.position ?? (await geolocation.request());
        if (pos) {
          lat = pos.lat;
          lng = pos.lng;
        }
      }

      const res = await Api.ponto({
        unitId: unit.id,
        employeeId: empMatch.id,
        kind: targetKind,
        registeredByEmployeeId: empMatch.id,
        lat,
        lng,
        punchPhotoPath,
      });

      const kindObj = KINDS.find((k) => k.value === targetKind);
      setScanState("success");
      const punchData = {
        fullName: empMatch.full_name,
        role: empMatch.role,
        kind: kindObj?.label ?? targetKind,
        atMs: res.atMs,
        nsr: res.nsr,
      };
      setAutoPunchResult(punchData);
      setPunchSuccessModal(punchData);
      setSelectedKind(null);
      playSuccessChime();

      setTimeout(() => {
        setAutoPunchResult(null);
        setScanState("scanning");
        setDetectedName(null);
      }, 5000);
    } catch (err) {
      setScanState("fail");
      toast.error(err instanceof Error ? err.message : "Erro ao registrar o ponto facial.");
      setTimeout(() => setScanState("scanning"), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function bater(kind: (typeof KINDS)[number]["value"]) {
    if (busy || !authedAs || !unit) return;
    setBusy(true);
    try {
      let punchPhotoPath: string | null = null;

      if (faceCapture.ready) {
        const captured = await faceCapture.capture();
        if (!captured) {
          toast.error("Não conseguimos identificar seu rosto na câmera. Centralize o rosto e tente de novo.");
          return;
        }
        if (myDescriptor && !isSameFace(captured.descriptor, myDescriptor)) {
          toast.error("O rosto na câmera não confere com o cadastro. Tente novamente ou chame um responsável.");
          return;
        }
        punchPhotoPath = await Api.uploadPontoFoto(authedAs.id, captured.photo, "punch");
      }

      let lat: number | null = null;
      let lng: number | null = null;
      if (geofenceRadiusM !== null) {
        const pos = geolocation.position ?? (await geolocation.request());
        if (!pos) {
          toast.error("Esta unidade exige localização para bater o ponto — libere o GPS e tente de novo.");
          return;
        }
        lat = pos.lat;
        lng = pos.lng;
      }

      const res = await Api.ponto({
        unitId: unit.id,
        employeeId: authedAs.id,
        kind,
        registeredByEmployeeId: authedAs.id,
        lat,
        lng,
        punchPhotoPath,
      });
      const kindObj = KINDS.find((k) => k.value === kind);
      const msgText = `Registrado às ${formatTime(res.atMs)} — NSR ${res.nsr}`;
      setMessage(msgText);
      const punchData = {
        fullName: authedAs.full_name,
        role: authedAs.role,
        kind: kindObj?.label ?? kind,
        atMs: res.atMs,
        nsr: res.nsr,
      };
      setPunchSuccessModal(punchData);
      playSuccessChime();

      // Recarrega marcações do dia
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      Api.pontoHistory(authedAs.id, startOfDay.getTime(), Date.now()).then(setToday);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a marcação de ponto. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const nextKind = getNextLogicalKind(today);

  function trocarColaborador() {
    faceCapture.stop();
    setSelected(null);
    setAuthedAs(null);
    setMessage(null);
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>{screenTitle}</h1>
        <Tabs
          value={mode}
          onChange={(v) => {
            if (v === "PIN_MANUAL" && isCurrentEmployeeBiometricEnrolled) {
              toast.error("Seleção por PIN desabilitada. Sua biometria facial está cadastrada, utilize o Facial Rápido.");
              return;
            }
            trocarColaborador();
            setMode(v as typeof mode);
          }}
          tabs={[
            { value: "FACIAL_RAPIDO", label: "⚡ Facial Rápido" },
            {
              value: "PIN_MANUAL",
              label: "🔑 Seleção / PIN",
              disabled: isCurrentEmployeeBiometricEnrolled,
            },
          ]}
        />
      </div>

      <HelpText>
        {mode === "FACIAL_RAPIDO"
          ? "Posicione seu rosto em frente ao terminal. O reconhecimento identifica o estagiário/colaborador e registra a frequência instantaneamente na Folha de Ponto."
          : "Registro via seleção de nome com PIN de validação."}
      </HelpText>

      {mode === "FACIAL_RAPIDO" && !authedAs && (
        <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", borderRadius: "18px" }}>
          <PunchPhotoCapture
            faceCapture={faceCapture}
            geolocation={geolocation}
            geofenceRadiusM={geofenceRadiusM}
            scanState={scanState}
            detectedName={detectedName}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>👉</span> Selecione o momento da jornada de trabalho:
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", width: "100%" }}>
              {KINDS.map((k) => {
                const isSelected = selectedKind === k.value;

                let bg = "#fdf2d4";
                let borderColor = "#976a16";
                let textColor = "#4c3407";
                let borderStyle = "solid";
                let IconComponent = IconAlmoco;

                if (k.value === "ENTRADA") {
                  bg = "#e4f2dc";
                  borderColor = "#507a32";
                  textColor = "#233816";
                  IconComponent = IconEntrada;
                } else if (k.value === "INTERVALO_INICIO") {
                  bg = "#fdf2d4";
                  borderColor = "#976a16";
                  textColor = "#4c3407";
                  IconComponent = IconAlmoco;
                } else if (k.value === "INTERVALO_FIM") {
                  bg = "#fdf2d4";
                  borderColor = "#976a16";
                  textColor = "#4c3407";
                  borderStyle = "dashed";
                  IconComponent = IconRetorno;
                } else if (k.value === "SAIDA") {
                  bg = "#fde4e4";
                  borderColor = "#b82e2e";
                  textColor = "#5e1313";
                  IconComponent = IconSaida;
                }

                return (
                  <button
                    key={k.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedKind(k.value)}
                    title={k.help}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      padding: "18px 12px",
                      borderRadius: "18px",
                      background: bg,
                      border: `2px ${borderStyle} ${borderColor}`,
                      boxShadow: isSelected
                        ? `0 6px 0 ${borderColor}, 0 8px 18px rgba(0,0,0,0.18)`
                        : `0 4px 0 ${borderColor}`,
                      color: textColor,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.6 : isSelected ? 1 : 0.85,
                      transform: isSelected ? "scale(1.03)" : "scale(1)",
                      transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                      outline: "none",
                      fontFamily: "var(--font-sans, system-ui, sans-serif)",
                    }}
                  >
                    {isSelected && (
                      <span
                        style={{
                          position: "absolute",
                          top: "6px",
                          right: "8px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          background: borderColor,
                          color: "#fff",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                        }}
                      >
                        ✓ Selecionado
                      </span>
                    )}

                    <IconComponent size={32} color={textColor} />

                    <span style={{ fontSize: "18px", fontWeight: "700", letterSpacing: "-0.3px" }}>
                      {k.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {faceCapture.ready && scanState === "scanning" && (
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              disabled={busy}
              onClick={handleAutoScan}
              style={{ borderRadius: "9999px", background: "linear-gradient(135deg, #10b981, #059669)", fontWeight: "bold" }}
            >
              📸 Reconhecer Rosto e Bater Ponto
            </Button>
          )}

          {autoPunchResult && (
            <div
              style={{
                padding: "16px",
                borderRadius: "14px",
                background: "rgba(16, 185, 129, 0.12)",
                border: "2px solid #10b981",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: "28px" }}>🎉</span>
              <strong style={{ fontSize: "18px", color: "var(--color-teal-text, #047857)" }}>
                Ponto Registrado com Sucesso!
              </strong>
              <div style={{ fontSize: "15px", fontWeight: "600" }}>
                {autoPunchResult.fullName} {autoPunchResult.role === "ESTAGIARIO" ? "(🎓 Estagiário)" : ""}
              </div>
              <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                {autoPunchResult.kind} às {formatTime(autoPunchResult.atMs)} — NSR #{autoPunchResult.nsr}
              </div>
              <div style={{ fontSize: "12px", background: "#10b981", color: "#fff", padding: "3px 10px", borderRadius: "9999px", marginTop: "4px" }}>
                ✓ Enviado automaticamente para a Folha de Ponto
              </div>
            </div>
          )}
        </Card>
      )}

      {mode === "PIN_MANUAL" && (
        <>
          {!selected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <HelpText icon="👆">Toque no seu nome para começar:</HelpText>
              {employees.map((emp) => {
                const empHasFace = enrolledFaceList.some((e) => e.id === emp.id);
                return (
                  <Card
                    key={emp.id}
                    onClick={() => {
                      if (empHasFace) {
                        toast.error(
                          `O colaborador ${emp.full_name} possui Biometria Facial cadastrada. Por favor, utilize o Facial Rápido.`,
                        );
                        return;
                      }
                      setSelected(emp);
                    }}
                    style={{
                      cursor: empHasFace ? "not-allowed" : "pointer",
                      padding: "12px",
                      opacity: empHasFace ? 0.6 : 1,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      {emp.full_name} {emp.role === "ESTAGIARIO" ? "(🎓 Estagiário)" : ""}
                    </span>
                    {empHasFace && (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                        ⚡ Biometria Facial ativa (PIN desabilitado)
                      </span>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : !authedAs ? (
            <Modal onClose={trocarColaborador} ariaLabel="Confirmar identidade" maxWidth="420px">
              <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
                {isEstagiario ? "Para registrar a frequência de" : "Para bater o ponto de"} <strong>{selected.full_name}</strong>, confirme com login ou PIN.
              </p>
              <EmployeeAuthGate restrictToEmployeeId={selected.id} onAuthenticated={setAuthedAs} onCancel={trocarColaborador} />
            </Modal>
          ) : (
            <>
              <h2>{authedAs.full_name}</h2>

              <PunchPhotoCapture faceCapture={faceCapture} geolocation={geolocation} geofenceRadiusM={geofenceRadiusM} />

              <HelpText icon="👉">
                Próxima marcação: <strong>{KINDS.find((k) => k.value === nextKind)?.label ?? nextKind}</strong>
              </HelpText>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", margin: "16px 0" }}>
                {KINDS.map((k) => {
                  const isNext = k.value === nextKind;
                  const isDone = KINDS.findIndex((x) => x.value === k.value) < KINDS.findIndex((x) => x.value === nextKind);

                  let bg = "#fdf2d4";
                  let borderColor = "#976a16";
                  let textColor = "#4c3407";
                  let borderStyle = "solid";
                  let IconComponent = IconAlmoco;

                  if (k.value === "ENTRADA") {
                    bg = "#e4f2dc";
                    borderColor = "#507a32";
                    textColor = "#233816";
                    IconComponent = IconEntrada;
                  } else if (k.value === "INTERVALO_INICIO") {
                    bg = "#fdf2d4";
                    borderColor = "#976a16";
                    textColor = "#4c3407";
                    IconComponent = IconAlmoco;
                  } else if (k.value === "INTERVALO_FIM") {
                    bg = "#fdf2d4";
                    borderColor = "#976a16";
                    textColor = "#4c3407";
                    borderStyle = "dashed";
                    IconComponent = IconRetorno;
                  } else if (k.value === "SAIDA") {
                    bg = "#fde4e4";
                    borderColor = "#b82e2e";
                    textColor = "#5e1313";
                    IconComponent = IconSaida;
                  }

                  return (
                    <button
                      key={k.value}
                      type="button"
                      disabled={busy || (!isNext && !isDone)}
                      onClick={() => bater(k.value)}
                      title={isNext ? k.help : isDone ? "Já registrado hoje" : "Aguarde a sequência de marcação"}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        padding: "24px 16px",
                        borderRadius: "20px",
                        background: bg,
                        border: `2px ${borderStyle} ${borderColor}`,
                        boxShadow: isDone
                          ? `0 2px 0 ${borderColor}`
                          : isNext
                            ? `0 6px 0 ${borderColor}, 0 10px 20px rgba(0,0,0,0.12)`
                            : `0 4px 0 ${borderColor}`,
                        color: textColor,
                        cursor: busy || (!isNext && !isDone) ? "not-allowed" : "pointer",
                        opacity: isDone ? 0.7 : !isNext ? 0.8 : 1,
                        transform: isNext ? "scale(1.02)" : "scale(1)",
                        transition: "all 0.15s ease-in-out",
                        outline: "none",
                        fontFamily: "var(--font-sans, system-ui, sans-serif)",
                      }}
                    >
                      {isDone && (
                        <span
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "10px",
                            fontSize: "11px",
                            fontWeight: "bold",
                            background: borderColor,
                            color: "#fff",
                            padding: "2px 8px",
                            borderRadius: "10px",
                          }}
                        >
                          ✓ Registrado
                        </span>
                      )}

                      <IconComponent size={34} color={textColor} />

                      <span style={{ fontSize: "20px", fontWeight: "700", letterSpacing: "-0.3px" }}>
                        {k.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Badge de Conformidade MTP Portaria 671/2021 & Geofencing */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "12px",
                  background: "var(--surface-sunken, #f4f4f5)",
                  border: "1px solid rgba(0,0,0,0.06)",
                  fontSize: "12px",
                  color: "var(--text-muted, #666)",
                  fontWeight: "500",
                }}
              >
                <span>🛡️ Marcação de Jornada REP-P</span>
                <span>•</span>
                <span>Portaria 671/2021 MTP</span>
                {geofenceRadiusM !== null && (
                  <>
                    <span>•</span>
                    <span style={{ color: "#059669", fontWeight: "600" }}>📍 Geofencing Ativo</span>
                  </>
                )}
              </div>

              {message && <p style={{ color: "var(--color-teal-text)" }}>{message}</p>}

              <h3>Marcações de hoje</h3>
              <ul>
                {today.map((r) => (
                  <li key={r.id}>
                    {formatTime(r.at_ms)} — {r.kind} (NSR {r.nsr})
                  </li>
                ))}
                {today.length === 0 && <li>Nenhuma marcação ainda.</li>}
              </ul>

              <Button variant="ghost" onClick={trocarColaborador}>
                trocar colaborador
              </Button>
            </>
          )}
        </>
      )}

      {punchSuccessModal && (
        <Modal onClose={() => setPunchSuccessModal(null)} ariaLabel="Confirmação de Registro de Ponto" maxWidth="460px">
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "10px 4px" }}>
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981, #059669)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "32px",
                color: "#fff",
                boxShadow: "0 8px 20px rgba(16, 185, 129, 0.35)",
              }}
            >
              ✓
            </div>

            <h2 style={{ margin: 0, fontSize: "22px", fontFamily: "var(--font-display)", color: "#10b981" }}>
              Ponto Registrado com Sucesso!
            </h2>

            <div style={{ background: "var(--surface-sunken)", width: "100%", padding: "14px", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "16px", fontWeight: "bold" }}>
                {punchSuccessModal.fullName} {punchSuccessModal.role === "ESTAGIARIO" ? "🎓 (Estagiário)" : ""}
              </div>
              <div style={{ fontSize: "15px", color: "var(--color-teal-text)", fontWeight: "600" }}>
                📍 {punchSuccessModal.kind} às {formatTime(punchSuccessModal.atMs)}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                NSR #{punchSuccessModal.nsr} · {new Date(punchSuccessModal.atMs).toLocaleDateString("pt-BR")}
              </div>
            </div>

            <div style={{ fontSize: "13px", color: "#059669", background: "rgba(16, 185, 129, 0.1)", padding: "6px 14px", borderRadius: "20px", fontWeight: "500" }}>
              ✓ Salvo na Folha de Ponto e sincronizado com o sistema
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={() => setPunchSuccessModal(null)}
              style={{ width: "100%", marginTop: "8px", borderRadius: "10px", background: "linear-gradient(135deg, #10b981, #059669)" }}
            >
              OK, Entendido
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
