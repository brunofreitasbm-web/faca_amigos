import { useEffect, useState } from "react";
import { Button, Card, Modal, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee, PontoRecord } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { EmployeeAuthGate } from "../components/EmployeeAuthGate.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";
import { PunchPhotoCapture } from "../components/PunchPhotoCapture.js";
import { useFaceCapture } from "../hooks/useFaceCapture.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { isSameFace } from "../lib/faceRecognition.js";

const KINDS = [
  { value: "ENTRADA", label: "Entrada", help: "Registrar que você chegou para trabalhar agora" },
  { value: "INTERVALO_INICIO", label: "Início do intervalo", help: "Registrar que você está saindo para o intervalo/almoço" },
  { value: "INTERVALO_FIM", label: "Fim do intervalo", help: "Registrar que você voltou do intervalo/almoço" },
  { value: "SAIDA", label: "Saída", help: "Registrar que você está indo embora ao final do expediente" },
] as const;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Bater ponto (Portaria MTP 671/2021 — ver packages/db-local/repositories/ponto.ts).
 * Sem edição/exclusão por desenho: cada marcação é um registro novo,
 * com NSR sequencial próprio.
 *
 * A marcação só vale legalmente se for a própria pessoa batendo — por
 * isso, escolher um colaborador na lista não libera os botões direto: é
 * preciso provar, com login real ou PIN de terminal já cadastrado, que
 * quem está na frente da tela é aquele colaborador (EmployeeAuthGate).
 * O servidor (fa_register_ponto) também recusa qualquer employee_id que
 * não bata com a sessão autenticada — a tela é só a primeira barreira.
 */
export function PontoScreen() {
  const { unit, employee } = useAppState();
  // Estagiário não "bate ponto" no vocabulário do RH — é "Controle de
  // Frequência". Mesmo fluxo e mesma RPC (fa_register_ponto), só o rótulo
  // muda pra quem só tem a capacidade ponto.self.
  const isEstagiario = employee?.role === "ESTAGIARIO";
  const screenTitle = isEstagiario ? "Controle de Frequência" : "Bater ponto";
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [authedAs, setAuthedAs] = useState<TerminalEmployee | null>(null);
  const [today, setToday] = useState<PontoRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [myDescriptor, setMyDescriptor] = useState<number[] | null>(null);

  const faceCapture = useFaceCapture();
  const geolocation = useGeolocation();
  const geofenceRadiusM = unit?.geofence_radius_m ?? null;

  useEffect(() => {
    Api.employees().then(setEmployees);
  }, []);

  useEffect(() => {
    if (!authedAs) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    Api.pontoHistory(authedAs.id, startOfDay.getTime(), Date.now()).then(setToday);
  }, [authedAs, message]);

  // Liga a câmera e busca o descriptor cadastrado assim que a identidade é
  // confirmada por PIN/login — cada marcação depois disso reaproveita a
  // mesma câmera já ligada, só tira um frame novo por clique.
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

  async function bater(kind: (typeof KINDS)[number]["value"]) {
    // Guarda extra contra duplo clique/double-tap: `disabled={busy}` no
    // botão já cobre o caso normal, mas dois eventos de clique disparados
    // antes do primeiro re-render (comum em touch) chamariam bater() duas
    // vezes. A garantia real está no servidor (fa_register_ponto recusa
    // marcação repetida em <5s); isto aqui só evita a segunda chamada de
    // rede desnecessária.
    if (busy || !authedAs || !unit) return;
    setBusy(true);
    try {
      let punchPhotoPath: string | null = null;

      // Reconhecimento facial: só bloqueia quem já tem rosto cadastrado —
      // colaborador sem cadastro ainda (ver ColaboradoresTab > Cadastrar
      // rosto) continua batendo ponto normalmente por PIN/login, sem essa
      // segunda checagem, pra não travar quem nunca foi cadastrado.
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
    } catch (err) {
      // Sem catch aqui, uma falha ficava muda: a marcação (registro
      // legal, Portaria MTP 671/2021) podia não ter sido gravada e o
      // colaborador saía achando que bateu ponto.
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
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>{screenTitle}</h1>
      <HelpText>
        Registro obrigatório de horário de trabalho. Toque no seu nome na lista abaixo, confirme que é você com
        login/PIN e depois escolha o que está registrando (chegada, saída ou intervalo).
      </HelpText>

      {!selected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <HelpText icon="👆">Toque no seu nome para começar:</HelpText>
          {employees.map((emp) => (
            <Card key={emp.id} onClick={() => setSelected(emp)} style={{ cursor: "pointer", padding: "12px" }}>
              {emp.full_name}
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
    </div>
  );
}
