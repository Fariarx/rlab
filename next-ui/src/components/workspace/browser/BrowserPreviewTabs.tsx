import LanguageIcon from "@mui/icons-material/Language";
import { Box } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { browserTabHost, browserTabLabel, type BrowserTab } from "../../../lib/browser-preview-model";
import { PreviewTabFaviconStore } from "./browser-preview-store";

export const BrowserPreviewTabs = observer(function BrowserPreviewTabs({
  tabs,
  activeTabId,
  onSelectTab,
  t,
}: {
  readonly tabs: readonly BrowserTab[];
  readonly activeTabId: string | null;
  readonly onSelectTab: (tab: BrowserTab) => void;
  readonly t: I18nApi["t"];
}) {
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <Box
      role="tablist"
      aria-label={t("browserPreviewTabsLabel")}
      sx={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "flex-end",
        gap: 0.5,
        px: 1,
        pt: 0.75,
        overflowX: "auto",
        borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s1,
        // Hide the horizontal scrollbar while keeping the row scrollable.
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeTabId;
        return (
          <Box
            key={tab.id}
            role="tab"
            aria-selected={selected}
            tabIndex={0}
            title={tab.url}
            onClick={() => onSelectTab(tab)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab);
              }
            }}
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 0.625,
              minWidth: 0,
              maxWidth: 200,
              height: 30,
              pl: 1,
              pr: 1.25,
              cursor: "pointer",
              borderTopLeftRadius: (theme) => `${theme.custom.radii.md}px`,
              borderTopRightRadius: (theme) => `${theme.custom.radii.md}px`,
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              borderBottom: "none",
              mb: selected ? "-1px" : 0,
              backgroundColor: (theme) => (selected ? theme.custom.surfaces.s2 : theme.custom.surfaces.s1),
              color: (theme) => (selected ? theme.palette.text.primary : theme.palette.text.secondary),
              transition: "background-color 120ms ease, color 120ms ease",
              "&:hover": { backgroundColor: (theme) => (selected ? theme.custom.surfaces.s2 : theme.custom.surfaces.s3), color: "text.primary" },
              "&:focus-visible": { outline: (theme) => `2px solid ${theme.custom.borders.focus}`, outlineOffset: -2 },
              "&::after": selected
                ? { content: '""', position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundColor: (theme) => theme.palette.status.running.main, borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }
                : undefined,
            }}
          >
            <PreviewTabFavicon url={tab.url} />
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem" }}>
              {browserTabLabel(tab)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
});

const PreviewTabFavicon = observer(function PreviewTabFavicon({ url }: { readonly url: string }) {
  const [store] = useState(() => new PreviewTabFaviconStore());
  const { failed, setFailed } = store;
  const host = browserTabHost(url);
  if (!host || failed) {
    return <LanguageIcon sx={{ fontSize: 13, color: "text.tertiary", flex: "0 0 auto" }} />;
  }
  return (
    <Box
      component="img"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={13}
      height={13}
      onError={() => setFailed(true)}
      sx={{ flex: "0 0 auto", borderRadius: "2px", display: "block" }}
    />
  );
});
