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
  { value: "ENTRADA", label: "Entrada", help: "Registrar que você chegou para trabalhar agora" },
  { value: "INTERVALO_INICIO", label: "Início do intervalo", help: "Registrar que você está saindo para o intervalo/almoço" },
  { value: "INTERVALO_FIM", label: "Fim do intervalo", help: "Registrar que você voltou do intervalo/almoço" },
  { value: "SAIDA", label: "Saída", help: "Registrar que você está indo embora ao final do expediente" },
] as const;

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
  const { unit, employee } = useAppState();
  const isEstagiario = employee?.role === "ESTAGIARIO";
  const screenTitle = isEstagiario ? "Controle de Frequência" : "Bater ponto";
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

  const faceCapture = useFaceCapture();
  const geolocation = useGeolocation();
  const geofenceRadiusM = unit?.geofence_radius_m ?? null;

  const isScanningRef = useRef(false);

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
      const nextKind = getNextLogicalKind(userTodayPunches);

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
        kind: nextKind,
        registeredByEmployeeId: empMatch.id,
        lat,
        lng,
        punchPhotoPath,
      });

      setScanState("success");
      setAutoPunchResult({
        fullName: empMatch.full_name,
        role: empMatch.role,
        kind: KINDS.find((k) => k.value === nextKind)?.label ?? nextKind,
        atMs: res.atMs,
        nsr: res.nsr,
      });

      setTimeout(() => {
        setAutoPunchResult(null);
        setScanState("scanning");
        setDetectedName(null);
      }, 4500);
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
      setMessage(`Registrado às ${formatTime(res.atMs)} — NSR ${res.nsr}`);
      playSuccessChime();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a marcação de ponto. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

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
            trocarColaborador();
            setMode(v as typeof mode);
          }}
          tabs={[
            { value: "FACIAL_RAPIDO", label: "⚡ Facial Rápido" },
            { value: "PIN_MANUAL", label: "🔑 Seleção / PIN" },
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
              {employees.map((emp) => (
                <Card key={emp.id} onClick={() => setSelected(emp)} style={{ cursor: "pointer", padding: "12px" }}>
                  {emp.full_name} {emp.role === "ESTAGIARIO" ? "(🎓 Estagiário)" : ""}
                </Card>
              ))}
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {KINDS.map((k) => (
                  <Button key={k.value} variant="secondary" size="lg" disabled={busy} title={k.help} onClick={() => bater(k.value)}>
                    {k.label}
                  </Button>
                ))}
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
    </div>
  );
}
