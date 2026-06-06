import CheckIcon from "@mui/icons-material/Check";
import { Box, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Button } from "../ui";
import { pop } from "./anim";
import { StatusNote } from "./parts";
import { type OptionsBlock } from "./types";

/** OptionSelect — the agent offers choices; the user picks one or several. */
export function OptionSelect({ block }: { readonly block: OptionsBlock }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

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
          <StatusNote level="ok">Selected: {chosenLabels.join(", ")}</StatusNote>
        ) : (
          <Button variant="contained" size="small" disabled={selected.length === 0} onClick={() => setConfirmed(true)}>
            Confirm{block.multi && selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        )}
      </Box>
    </Box>
  );
}
