import { describe, expect, it } from "vitest";
import { clamp, formatTime, padNumber } from "./format";

describe("formatTime", () => {
  it("formatea minutos y segundos", () => {
    expect(formatTime(87.4)).toBe("01:27");
    expect(formatTime(228)).toBe("03:48");
    expect(formatTime(0)).toBe("00:00");
  });
  it("tolera valores inválidos y horas", () => {
    expect(formatTime(Number.NaN)).toBe("00:00");
    expect(formatTime(-3)).toBe("00:00");
    expect(formatTime(3723)).toBe("1:02:03");
  });
});

describe("utilidades", () => {
  it("rellena números de himno", () => {
    expect(padNumber(1)).toBe("001");
    expect(padNumber(613)).toBe("613");
  });
  it("limita valores", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
  });
});
