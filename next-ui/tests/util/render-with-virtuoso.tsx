import { type ReactElement } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { renderWithTheme } from "./render-with-theme";

export function withVirtuosoMock(ui: ReactElement): ReactElement {
  return <VirtuosoMockContext.Provider value={{ itemHeight: 96, viewportHeight: 720 }}>{ui}</VirtuosoMockContext.Provider>;
}

export function renderWithThemeAndVirtuoso(ui: ReactElement) {
  return renderWithTheme(withVirtuosoMock(ui));
}
