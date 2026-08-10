export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Idade legível a partir da data de nascimento (ISO "YYYY-MM-DD") — em meses para bebês com menos de 2 anos. */
export function formatAge(birthDate: string): string {
  if (!birthDate) return "";
  const isoPart = birthDate.split("T")[0] ?? "";
  const parts = isoPart.split("-");
  let birth: Date;
  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      birth = new Date(y, m - 1, d);
    } else {
      birth = new Date(birthDate);
    }
  } else {
    birth = new Date(birthDate);
  }
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 2) {
    const totalMonths = Math.max(0, years * 12 + months);
    return `${totalMonths} ${totalMonths === 1 ? "mês" : "meses"}`;
  }
  return `${years} anos`;
}

