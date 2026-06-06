import SearchIcon from "@mui/icons-material/Search";
import { Box, Dialog, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, KeyHint } from "../ui";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: readonly string[];
  readonly action: () => void;
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly items: readonly CommandPaletteItem[];
  readonly onClose: () => void;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function itemMatches(item: CommandPaletteItem, query: string): boolean {
  if (!query) {
    return true;
  }

  return [item.label, item.description, ...(item.keywords ?? [])].some((value) => value != null && normalize(value).includes(query));
}

export function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalize(query);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const visibleItems = useMemo(() => items.filter((item) => itemMatches(item, normalizedQuery)), [items, normalizedQuery]);
  const activeItem = visibleItems[activeIndex] ?? visibleItems[0];
  const listId = "command-palette-list";

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    if (activeIndex >= visibleItems.length) {
      setActiveIndex(Math.max(visibleItems.length - 1, 0));
    }
  }, [activeIndex, visibleItems.length]);

  const runCommand = (item: CommandPaletteItem) => {
    item.action();
    onClose();
  };
  const moveActive = (offset: -1 | 1) => {
    if (visibleItems.length === 0) {
      return;
    }
    setActiveIndex((current) => (current + offset + visibleItems.length) % visibleItems.length);
  };

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
              input: {
                "aria-controls": listId,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              },
            }}
          />

          {visibleItems.length > 0 ? (
            <Stack id={listId} aria-label={t("commandPalette")} spacing={0.75}>
              {visibleItems.map((item, index) => (
                <Button
                  key={item.id}
                  id={`command-palette-item-${item.id}`}
                  type="button"
                  aria-label={item.label}
                  aria-current={index === activeIndex ? "true" : undefined}
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
