import { describe, expect, it } from "vitest";
import { generateGainschaGS2208DTSPL } from "../src/printers/gainscha.js";

describe("generateGainschaGS2208DTSPL", () => {
  it("gera comandos TSPL em formato paisagem (270mm x 20mm) para a Gainscha GS-2208D", () => {
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: "#K7M2P9QX3B7",
      childName: "Helena Souza",
      guardianName: "Maria Souza",
      phone: "+5591982501215",
      planName: "30 minutos",
      entryTime: "14:30",
      notes: "Sensivel a ruido",
    });

    expect(tspl).toContain("SIZE 270 mm, 20 mm");
    expect(tspl).toContain("PRINT 1,1");
    expect(tspl).toContain('TEXT 850,16,"4",0,1,1,"HELENA SOUZA"');
    expect(tspl).toContain('TEXT 850,58,"2",0,1,1,"RESP: MARIA SOUZA"');
    expect(tspl).toContain('TEXT 850,88,"2",0,1,1,"TEL: +5591982501215"');
    expect(tspl).toContain('TEXT 20,90,"2",0,1,1,"ENTRADA 14:30 | 30 MINUTOS"');
    expect(tspl).toContain('TEXT 850,118,"2",0,1,1,"! SENSIVEL A RUIDO"');
  });

  it("imprime o QR com o codigo normalizado, correcao Q e celula de 6 pontos", () => {
    const tspl = generateGainschaGS2208DTSPL({
      // Como o codigo chega da tela: com hifen e com o # da exibicao.
      wristbandCode: "#K7M2-P9QX-3B7",
      childName: "Helena",
      guardianName: "Maria",
      phone: "+5591982501215",
    });

    // A URL unificada de acompanhamento e codificada no QR
    expect(tspl).toContain('QRCODE 330,16,Q,4,A,0,"https://app.facaamigos.com.br/?acompanhar=K7M2P9QX3B7"');
    // O mesmo codigo em texto, agrupado para leitura humana.
    expect(tspl).toContain('TEXT 480,36,"4",0,1,1,"K7M2-P9QX-3B7"');
  });

  it("repete nome e codigo na outra ponta da faixa (a pulseira da a volta no pulso)", () => {
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: "K7M2P9QX3B7",
      childName: "Helena Souza",
      guardianName: "Maria Souza",
      phone: "+5591982501215",
    });

    expect(tspl).toContain('TEXT 1700,26,"3",0,1,1,"HELENA SOUZA"');
    expect(tspl).toContain('TEXT 1700,66,"3",0,1,1,"K7M2-P9QX-3B7"');
  });

  it("mantem a pulseira antiga legivel na reimpressao, sem normalizar o payload", () => {
    const legado = `FA1|W|${"a".repeat(32)}|${"b".repeat(8)}`;
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: legado,
      childName: "Helena",
      guardianName: "Maria",
      phone: "+5591982501215",
    });

    // Normalizar destruiria o payload (viraria maiusculo e sem o "|"), e o
    // codigo impresso deixaria de casar com o que esta gravado na sessao.
    expect(tspl).toContain(`QRCODE 330,16,Q,4,A,0,"${legado}"`);
  });

  it("neutraliza acento e aspas, que corrompem a impressao RAW", () => {
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: "K7M2P9QX3B7",
      // Aspas duplas fechariam a string do comando TSPL no meio e a
      // impressora descartaria a etiqueta inteira em silencio.
      childName: 'Antônio "Tuninho" Gonçalves',
      guardianName: "José da Conceição",
      phone: "+5591982501215",
    });

    expect(tspl).not.toContain('"Tuninho"');
    expect(tspl).toContain("ANTONIO TUNINHO GONCALVES");
    expect(tspl).toContain("RESP: JOSE DA CONCEICAO");
  });

  it("trunca nome comprido para nao invadir a zona seguinte da etiqueta", () => {
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: "K7M2P9QX3B7",
      childName: "Maria Eduarda dos Santos Albuquerque Cavalcanti",
      guardianName: "Maria",
      phone: "+5591982501215",
    });

    const linha = tspl.split("\r\n").find((l) => l.startsWith("TEXT 850,16"))!;
    const conteudo = linha.slice(linha.indexOf('1,1,"') + 5, -1);
    expect(conteudo.length).toBeLessThanOrEqual(26);
    expect(conteudo.endsWith(".")).toBe(true);
  });
});
