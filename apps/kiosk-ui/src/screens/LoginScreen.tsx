import { useEffect, useState } from "react";
import { Card, Button } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { PinPad } from "../components/PinPad.js";

export function LoginScreen() {
  const { login } = useAppState();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Api.employees().then(setEmployees);
  }, []);

  async function handleSubmit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await login(selected.id, pin);
    } catch {
      setError("PIN incorreto");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return (
      <div style={{ maxWidth: "480px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>Quem está operando?</h1>
        {employees.map((emp) => (
          <Card key={emp.id} onClick={() => setSelected(emp)} style={{ cursor: "pointer", padding: "16px" }}>
            <strong>{emp.full_name}</strong> — {emp.role}
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "360px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>{selected.full_name}</h1>
      {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}
      <PinPad value={pin} onChange={setPin} onSubmit={handleSubmit} disabled={busy} />
      <Button variant="ghost" onClick={() => setSelected(null)}>
        não é você? trocar
      </Button>
    </div>
  );
}
