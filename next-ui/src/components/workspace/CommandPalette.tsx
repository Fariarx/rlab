import SearchIcon from "@mui/icons-material/Search";
import { Box, Dialog, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, KeyHint } from "../ui";
import { type CommandPaletteItem, useCommandPaletteController } from "./hooks/use-command-palette-controller";

export type { CommandPaletteItem } from "./hooks/use-command-palette-controller";

interface CommandPaletteProps {
  readonly open: boolean;
  readonly items: readonly CommandPaletteItem[];
  readonly onClose: () => void;
}

export function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const { query, setQuery, activeIndex, setActiveIndex, activeItem, visibleItems, listId, moveActive, runCommand } = useCommandPaletteController({ open, items, onClose });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="command-palette-title">
      <DialogTitle id="command-palette-title" sx={{ pb: 1 }}>
        {t("commandPalette")}
      </DialogTitle>
      <DialogContent sx={{ pt: 0, pb: 2.5 }}>
        <Stack spacing={1.5}>
          <TextField
            autoFocus
            fullWidth
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === "Enter" && activeItem) {
                event.preventDefault();
                runCommand(activeItem);
              }
            }}
            placeholder={t("commandSearchPlaceholder")}
            slotProps={{
              htmlInput: {
                "aria-activedescendant": activeItem ? `command-palette-item-${activeItem.id}` : undefined,
                "aria-autocomplete": "list",
                "aria-controls": listId,
                "aria-expanded": open ? "true" : "false",
                "aria-label": t("commandPalette"),
                role: "combobox",
              },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              },
            }}
          />

          {visibleItems.length > 0 ? (
            <Stack id={listId} role="listbox" aria-label={t("commandPalette")} spacing={0.75}>
              {visibleItems.map((item, index) => (
                <Button
                  key={item.id}
                  id={`command-palette-item-${item.id}`}
                  role="option"
                  type="button"
                  aria-label={item.label}
                  aria-current={index === activeIndex ? "true" : undefined}
                  aria-selected={index === activeIndex ? "true" : "false"}
                  onClick={() => runCommand(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  sx={{
                    justifyContent: "space-between",
                    px: 1.25,
                    py: 1,
                    textAlign: "left",
                    borderRadius: (theme) => `${theme.custom.radii.md}px`,
                    color: "text.primary",
                    backgroundColor: (theme) => (index === activeIndex ? theme.custom.surfaces.s3 : theme.custom.surfaces.s2),
                    "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: "0.86rem", fontWeight: 650 }}>
                      {item.label}
                    </Typography>
                    {item.description && (
                      <Typography noWrap sx={{ fontSize: "0.74rem", color: "text.secondary" }}>
                        {item.description}
                      </Typography>
                    )}
                  </Box>
                  {item.shortcut && <KeyHint keys={item.shortcut} separator="+" />}
                </Button>
              ))}
            </Stack>
          ) : (
            <Typography sx={{ py: 2, textAlign: "center", color: "text.secondary", fontSize: "0.82rem" }}>{t("commandNoMatches")}</Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
