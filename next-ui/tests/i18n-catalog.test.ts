import { describe, expect, it } from "vitest";
import { agentStatusLabel, conversationStatusLabel, translate } from "../src/i18n/i18n-catalog";

describe("i18n-catalog", () => {
  it("formats translated strings with named parameters", () => {
    expect(translate("en", "messagePlaceholder", { title: "Codex" })).toBe("Message Codex");
    expect(translate("ru", "messagePlaceholder", { title: "Codex" })).toBe("Написать: Codex");
  });

  it("returns typed status labels without React context", () => {
    expect(agentStatusLabel("en", "needs-setup")).toBe("Needs setup");
    expect(agentStatusLabel("ru", "needs-setup")).toBe("Нужна настройка");
    expect(conversationStatusLabel("en", "waiting")).toBe("Needs input");
    expect(conversationStatusLabel("ru", "waiting")).toBe("Ждёт ввод");
  });
});
