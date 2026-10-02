import { describe, expect, it } from "vitest";
import type { MonitorInfo } from "../../types/domain";
import { matchMonitor } from "./ProjectionControls";

const monitor = (name: string, x: number, primary = false): MonitorInfo => ({
  id: `${name}@${x},0`,
  name,
  x,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
  primary,
});

describe("matchMonitor", () => {
  const saved = { name: "EPSON", x: 1920, y: 0, width: 1920, height: 1080 };

  it("encuentra el monitor guardado", () => {
    expect(matchMonitor(saved, [monitor("Built-in", 0, true), monitor("EPSON", 1920)])?.name).toBe("EPSON");
  });

  it("sigue a un monitor movido o renombrado sin adivinar", () => {
    expect(matchMonitor(saved, [monitor("Built-in", 0, true), monitor("EPSON", -1920)])?.x).toBe(-1920);
    expect(matchMonitor(saved, [monitor("Built-in", 0, true), monitor("HDMI", 1920)])?.name).toBe("HDMI");
    expect(matchMonitor(saved, [monitor("Built-in", 0, true)])).toBeUndefined();
    expect(matchMonitor(null, [monitor("Built-in", 0, true)])).toBeUndefined();
  });
});
