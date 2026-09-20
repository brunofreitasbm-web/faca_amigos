import { useEffect, useRef, useState } from "react";
import { Button, Card, HelpText, Modal, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { PendingHandover } from "../api/client.js";
import { OfflineQueuedError } from "../lib/supabase/offlineQueue.js";
import { ackDelayFor } from "../lib/passagemTurno.js";

export interface PassagemTurnoGateProps {
  unitId: string;
  employeeId: string;
  /** Turno em que a leitura aconteceu — fica registrado junto com a ciência. */
  shiftId: string | null;
  onDone: () => void;
}

function dataCurta(businessDate: string): string {
  const [ano, mes, dia] = businessDate.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : businessDate;
}

/**
 * Portão de leitura da passagem de turno.
 *
 * Aparece logo depois de abrir o caixa, para quem abriu: é literalmente a
 * primeira tela do dia. Não fecha por Escape, por clique no fundo nem por
 * botão de fechar — a única saída é confirmar a ciência, e o botão só
 * habilita depois de uma contagem regressiva proporcional ao tamanho do
 * texto.
 *
 * Nada é guardado em localStorage: a pendência é recalculada no servidor a
 * cada montagem, então recarregar a página (o contorno óbvio num quiosque)
 * traz o portão de volta.
 */
export function PassagemTurnoGate({ unitId, employeeId, shiftId, onDone }: PassagemTurnoGateProps) {
  const [pending, setPending] = useState<PendingHandover[] | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erroAck, setErroAck] = useState<string | null>(null);
  const [restanteMs, setRestanteMs] = useState<number | null>(null);
  const abertoEmRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelado = false;
    setNetworkError(false);
    Api.pendingHandovers(unitId, employeeId)
      .then((rows) => {
        if (cancelado) return;
        abertoEmRef.current = Date.now();
        setPending(rows);
      })
      .catch((err) => {
        if (cancelado) return;
        // Falha ABERTA em bug, FECHADA em queda de rede. Um quiosque travado
        // por deploy ruim (RPC inexistente, RLS errada) para a operação
        // inteira da loja; uma leitura perdida não. Já uma queda de rede é
        // transitória e não justifica liberar a passagem.
        if (err instanceof TypeError) {
          setNetworkError(true);
        } else {
          console.warn("[passagem-turno] não foi possível carregar pendências:", err);
          onDone();
        }
      });
    return () => {
      cancelado = true;
    };
    // Recarrega quando muda o funcionário ou a unidade; `onDone` é estável
    // o bastante nos dois call sites e entraria em laço se virasse dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, employeeId]);

  // Contagem regressiva do botão de ciência. Não impede o clique automático
  // — só encarece o suficiente para ler sair mais barato que esperar. O
  // tempo real gasto vai para `leitura_ms` e aparece no Gerencial.
  useEffect(() => {
    if (!pending || pending.length === 0) return;
    const totalMs = pending.reduce((maior, h) => Math.max(maior, ackDelayFor(h.conteudo)), 0);
    const liberaEm = abertoEmRef.current + totalMs;
    setRestanteMs(Math.max(0, liberaEm - Date.now()));
    const timer = setInterval(() => {
      const falta = Math.max(0, liberaEm - Date.now());
      setRestanteMs(falta);
      if (falta === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [pending]);

  if (networkError) {
    return (
      <Modal
        title="Passagem de Turno"
        ariaLabel="Passagem de turno indisponível"
        onClose={() => {}}
        dismissible={false}
        maxWidth="520px"
        zIndex={9999}
      >
        <p style={{ marginTop: 0 }}>
          Não foi possível carregar a passagem de turno do dia anterior. Verifique a conexão e tente
          novamente — ela precisa ser lida antes de operar.
        </p>
        <Button
          variant="primary"
          fullWidth
          onClick={() => {
            setPending(null);
            setNetworkError(false);
            Api.pendingHandovers(unitId, employeeId)
              .then((rows) => {
                abertoEmRef.current = Date.now();
                setPending(rows);
              })
              .catch(() => setNetworkError(true));
          }}
        >
          Tentar novamente
        </Button>
      </Modal>
    );
  }

  if (!pending || pending.length === 0) return null;

  const liberado = restanteMs !== null && restanteMs === 0;
  const segundos = Math.ceil((restanteMs ?? 0) / 1000);

  async function confirmar() {
    if (!pending) return;
    setBusy(true);
    setErroAck(null);
    const leituraMs = Date.now() - abertoEmRef.current;
    try {
      for (const h of pending) {
        await Api.ackHandover(h.id, employeeId, shiftId, leituraMs);
      }
      onDone();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // A ciência foi para a fila, mas o portão continua de pé: liberar
        // agora deixaria o registro de leitura pendurado numa sincronização
        // que pode falhar, e o livro passaria a valer menos que o papel.
        setErroAck("Sem conexão: a ciência foi salva e será enviada quando a rede voltar. Aguarde a sincronização.");
      } else {
        setErroAck(err instanceof Error && err.message ? err.message : "Não foi possível registrar a ciência.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={pending.length > 1 ? `Passagem de Turno (${pending.length} dias)` : "Passagem de Turno"}
      ariaLabel="Passagem de turno do dia anterior"
      onClose={() => {}}
      dismissible={false}
      maxWidth="640px"
      zIndex={9999}
    >
      <HelpText>
        Leia antes de começar a operar. Foi escrito por quem fechou o caixa e não pôde te encontrar
        pessoalmente.
      </HelpText>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
        {pending.map((h) => (
          <Card
            key={h.id}
            title={`${dataCurta(h.business_date)} — ${h.closed_by_name ?? "operador não identificado"}`}
          >
            {h.no_changes ? (
              <Tag>Sem alteração registrada</Tag>
            ) : (
              <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "16px", lineHeight: 1.6 }}>{h.conteudo}</p>
            )}
          </Card>
        ))}
      </div>

      <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
        Mostrando os últimos 7 dias não lidos. O histórico completo fica em Gerencial &gt; Passagem de Turno.
      </p>

      {erroAck && (
        <p role="alert" style={{ fontSize: "14px", color: "var(--color-error-text)", margin: "0 0 8px" }}>
          {erroAck}
        </p>
      )}

      <Button variant="primary" size="lg" fullWidth disabled={!liberado || busy} loading={busy} onClick={confirmar}>
        {liberado ? "Li e estou ciente" : `Li e estou ciente (${segundos}s)`}
      </Button>
    </Modal>
  );
}
