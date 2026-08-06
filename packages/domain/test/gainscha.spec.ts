import { describe, expect, it } from "vitest";
import { generateGainschaGS2208DTSPL } from "../src/printers/gainscha.js";

describe("generateGainschaGS2208DTSPL", () => {
  it("gera comandos TSPL em formato paisagem (270mm x 20mm) para a Gainscha GS-2208D", () => {
    const tspl = generateGainschaGS2208DTSPL({
      wristbandCode: "#987654",
      childName: "Helena Souza",
      guardianName: "Maria Souza",
      phone: "+5591982501215",
      planName: "30 minutos",
      entryTime: "14:30",
      notes: "Sensível a ruído",
    });

    expect(tspl).toContain("SIZE 270 mm, 20 mm");
    expect(tspl).toContain('BARCODE 420,20,"128",65,1,0,2,2,"987654"');
    expect(tspl).toContain('TEXT 900,25,"4",0,1,1,"CRIANCA: HELENA SOUZA"');
    expect(tspl).toContain('TEXT 900,90,"2",0,1,1,"RESP: MARIA SOUZA (+5591982501215)"');
    expect(tspl).toContain('TEXT 1650,30,"3",0,1,1,"ENTRADA: 14:30"');
    expect(tspl).toContain('TEXT 2100,30,"2",0,1,1,"OBS: SENSÍVEL A RUÍDO"');
    expect(tspl).toContain("PRINT 1,1");
  });
});
