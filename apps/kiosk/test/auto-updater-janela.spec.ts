import { describe, expect, it } from "vitest";
import { motivoParaInstalarAgora } from "../src/main/autoUpdater.js";

/**
 * Regressão do bug que prendeu a loja na 0.1.5, na 0.1.21 e na 0.1.35: o
 * instalador de ~105 MB terminava de baixar FORA da janela de 5 minutos após
 * o boot, e o único outro caminho de instalação era `window-all-closed` —
 * que nunca dispara, porque a loja corta a energia às 22h em vez de fechar o
 * app. A atualização ficava "baixada e pendente" para sempre.
 *
 * O que estes testes fixam é justamente o que era impossível observar num
 * terminal em operação: em que instantes do dia a instalação PODE acontecer.
 */
const em = (hora: number, minuto = 0) => new Date(2026, 8, 9, hora, minuto, 0);
const bootAgora = (d: Date) => d.getTime();
const bootHaHoras = (d: Date, horas: number) => d.getTime() - horas * 3600_000;

describe("motivoParaInstalarAgora", () => {
  it("instala na abertura do dia, mesmo com o download demorando bem mais que os 5 min antigos", () => {
    const agora = em(10, 20);
    // App subiu às 10h; o download só terminou 20 min depois. Na lógica
    // antiga isso caía fora da janela e nunca mais era instalado.
    expect(motivoParaInstalarAgora(agora, bootHaHoras(agora, 1 / 3))).toBe("abertura");
  });

  it("não interrompe atendimento no meio do expediente", () => {
    const agora = em(15);
    expect(motivoParaInstalarAgora(agora, bootHaHoras(agora, 5))).toBeNull();
  });

  it("instala no pré-fechamento, antes de a energia cair às 22h", () => {
    const agora = em(21, 5);
    expect(motivoParaInstalarAgora(agora, bootHaHoras(agora, 11))).toBe("pre-fechamento");
  });

  it("instala com o terminal ligado fora do expediente", () => {
    const antesDeAbrir = em(7);
    expect(motivoParaInstalarAgora(antesDeAbrir, bootHaHoras(antesDeAbrir, 2))).toBe("fora-do-expediente");
    const depoisDeFechar = em(22, 30);
    expect(motivoParaInstalarAgora(depoisDeFechar, bootHaHoras(depoisDeFechar, 12))).toBe("fora-do-expediente");
  });

  it("todo dia de operação tem pelo menos uma janela de instalação", () => {
    // A garantia que faltava: qualquer que seja a hora em que o download
    // termine, existe um instante posterior no MESMO dia em que instala.
    const boot = bootAgora(em(10));
    const houveJanela = Array.from({ length: 24 }, (_, hora) => motivoParaInstalarAgora(em(hora, 30), boot));
    expect(houveJanela.filter(Boolean).length).toBeGreaterThan(0);
    expect(motivoParaInstalarAgora(em(21, 30), boot)).not.toBeNull();
  });
});
