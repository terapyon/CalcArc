import { afterEach, describe, expect, it } from "vitest";
import {
  ESCAPE_LAYER,
  escapeTakenAbove,
  openEscapeLayer,
  resetEscapeLayersForTest,
} from "./escapeLayers";

afterEach(() => {
  resetEscapeLayersForTest();
});

describe("escapeLayers", () => {
  it("puts the links above the update notice", () => {
    // **順は裁定である**(0.9.3 設計書 §2.5、裁定 #4):
    // リンク集 → 更新のお知らせ → `ac`。
    expect(ESCAPE_LAYER.links).toBeGreaterThan(ESCAPE_LAYER.updateToast);
  });

  it("lets a layer take Escape while nothing is open above it", () => {
    expect(escapeTakenAbove(ESCAPE_LAYER.updateToast)).toBe(false);
    expect(escapeTakenAbove(ESCAPE_LAYER.links)).toBe(false);
  });

  it("holds Escape away from the layer below while the links are open", () => {
    const close = openEscapeLayer(ESCAPE_LAYER.links);
    expect(escapeTakenAbove(ESCAPE_LAYER.updateToast)).toBe(true);
    // **いちばん上は、自分自身に譲らない。**
    expect(escapeTakenAbove(ESCAPE_LAYER.links)).toBe(false);
    close();
    expect(escapeTakenAbove(ESCAPE_LAYER.updateToast)).toBe(false);
  });

  it("does not let a lower layer hold Escape away from an upper one", () => {
    const close = openEscapeLayer(ESCAPE_LAYER.updateToast);
    expect(escapeTakenAbove(ESCAPE_LAYER.links)).toBe(false);
    close();
  });

  it("forgets a layer only once, even if the closer is called twice", () => {
    const close = openEscapeLayer(ESCAPE_LAYER.links);
    close();
    close();
    expect(escapeTakenAbove(ESCAPE_LAYER.updateToast)).toBe(false);
  });
});
