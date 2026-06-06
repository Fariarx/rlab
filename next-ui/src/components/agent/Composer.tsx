import AttachFileIcon from "@mui/icons-material/AttachFile";
import SendIcon from "@mui/icons-material/Send";
import { Box, InputBase, Stack } from "@mui/material";
import { type KeyboardEvent, useState } from "react";
import { Button, IconButton, KeyHint } from "../ui";

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
export function Composer({
  placeholder = "Message the agent…",
  onSend,
}: {
  readonly placeholder?: string;
  readonly onSend?: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      onSend?.(trimmed);
      setValue("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        p: 1,
        borderRadius: (t) => `${t.custom.radii.lg}px`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        transition: "box-shadow 140ms ease, border-color 140ms ease",
        "&:focus-within": {
          borderColor: (t) => t.custom.borders.focus,
          boxShadow: (t) => `0 0 0 3px ${t.palette.status.running.soft}`,
        },
      }}
    >
      <IconButton aria-label="Attach" sx={{ mb: "1px" }}>
        <AttachFileIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <InputBase
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        multiline
        maxRows={6}
        sx={{ flex: 1, fontSize: "0.9rem", lineHeight: 1.5, py: 0.5 }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto" }}>
        <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", gap: 0.5 }}>
          <KeyHint keys="⏎" />
        </Box>
        <Button
          variant="contained"
          onClick={send}
          disabled={value.trim().length === 0}
          sx={{ minWidth: 0, px: 1.25, py: 1, borderRadius: (t) => `${t.custom.radii.md}px` }}
          aria-label="Send"
        >
          <SendIcon sx={{ fontSize: 18 }} />
        </Button>
      </Stack>
    </Box>
  );
}
