import { describe, expect, it } from "vitest";
import { buildAppTheme } from "../src/theme/app-theme";

describe("app theme factory", () => {
  it("builds a high-contrast theme", () => {
    const theme = buildAppTheme("high-contrast", "comfortable");

    expect(theme.palette.mode).toBe("dark");
    expect(theme.palette.background.default).toBe("#000000");
    expect(theme.palette.text.primary).toBe("#ffffff");
    expect(theme.custom.borders.strong).toBe("#ffffff");
  });

  it("applies compact density to spacing", () => {
    const comfortable = buildAppTheme("dark", "comfortable");
    const compact = buildAppTheme("dark", "compact");

    expect(comfortable.spacing(2)).toBe("16px");
    expect(compact.spacing(2)).toBe("12px");
    expect(compact.custom.density).toBe("compact");
  });
});
