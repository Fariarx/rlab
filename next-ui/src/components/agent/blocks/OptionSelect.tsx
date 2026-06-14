import CheckIcon from "@mui/icons-material/Check";
import { Box, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button } from "../../ui";
import { OptionSelectStore } from "../stores/agent-local-stores";
import { pop } from "../core/anim";
import { StatusNote } from "./parts";
import type { OptionsBlock } from "../core/types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** OptionSelect — the agent offers choices; the user picks one or several. */
export const OptionSelect = observer(function OptionSelect({
  block,
  onSelection,
}: {
  readonly block: OptionsBlock;
  readonly onSelection?: (optionBlockId: string, selectedLabels: readonly string[]) => void | Promise<void>;
}) {
  const [store] = useState(() => new OptionSelectStore(block.selected ?? []));
  const { selected, setSelected, confirmed, setConfirmed, pending, setPending, selectionError, setSelectionError } = store;
  const { t } = useI18n();

  useEffect(() => {
    if ((block.selected?.length ?? 0) === 0) {
      return;
    }
    setSelected([...(block.selected ?? [])]);
    setConfirmed(true);
  }, [block.selected, setConfirmed, setSelected]);

  const toggle = (id: string) => {
    if (confirmed) {
      return;
    }
    if (block.multi) {
      setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    } else {
      setSelected([id]);
    }
  };

  const chosenLabels = block.options.filter((o) => selected.includes(o.id)).map((o) => o.label);
  const confirm = () => {
    if (selected.length === 0) {
      return;
    }
    if (!block.id || !onSelection) {
      setConfirmed(true);
      return;
    }
    setPending(true);
    setSelectionError(null);
    void Promise.resolve(onSelection(block.id, chosenLabels))
      .then(() => setConfirmed(true))
      .catch((error) => setSelectionError(errorMessage(error)))
      .finally(() => setPending(false));
  };

  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        p: 1.5,
      }}
    >
      <Typography sx={{ fontSize: "0.86rem", mb: 1.25, color: "text.primary" }}>{block.prompt}</Typography>
      <Stack spacing={1}>
        {block.options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <Stack
              key={option.id}
              direction="row"
              spacing={1.25}
              onClick={() => toggle(option.id)}
              sx={{
                alignItems: "flex-start",
                p: 1.25,
                borderRadius: (t) => `${t.custom.radii.sm}px`,
                cursor: confirmed ? "default" : "pointer",
                border: (t) => `1px solid ${isSelected ? t.palette.status.running.border : t.custom.borders.subtle}`,
                backgroundColor: (t) => (isSelected ? t.palette.status.running.soft : t.custom.surfaces.s3),
                opacity: confirmed && !isSelected ? 0.5 : 1,
                transition: "border-color 160ms ease, background-color 160ms ease, transform 160ms ease",
                "&:hover": confirmed ? undefined : { transform: "translateY(-1px)", borderColor: (t) => t.palette.status.running.border },
              }}
            >
              <Box
                sx={{
                  mt: "1px",
                  flex: "0 0 auto",
                  width: 18,
                  height: 18,
                  borderRadius: block.multi ? "5px" : "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  border: (t) => `1.5px solid ${isSelected ? t.palette.status.running.main : t.custom.borders.strong}`,
                  backgroundColor: (t) => (isSelected ? t.palette.status.running.main : "transparent"),
                  transition: "background-color 160ms ease, border-color 160ms ease",
                }}
              >
                {isSelected && <CheckIcon sx={{ fontSize: 13, animation: `${pop} 220ms ease both` }} />}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: "0.84rem", fontWeight: 600, color: "text.primary" }}>{option.label}</Typography>
                {option.description && (
                  <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", mt: 0.25 }}>{option.description}</Typography>
                )}
              </Box>
            </Stack>
          );
        })}
      </Stack>

      <Box sx={{ mt: 1.5 }}>
        {confirmed ? (
          <StatusNote level="ok">{t("selectedOptions", { items: chosenLabels.join(", ") })}</StatusNote>
        ) : (
          <Button variant="contained" size="small" disabled={selected.length === 0 || pending} onClick={confirm}>
            {block.multi && selected.length > 0 ? t("confirmSelectionCount", { count: selected.length }) : t("confirm")}
          </Button>
        )}
        {selectionError && (
          <Box sx={{ mt: 1 }}>
            <StatusNote level="error">{t("optionSelectionError", { error: selectionError })}</StatusNote>
          </Box>
        )}
      </Box>
    </Box>
  );
});
