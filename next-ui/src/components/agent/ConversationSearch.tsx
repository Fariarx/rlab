import SearchIcon from "@mui/icons-material/Search";
import { Box, Dialog, DialogContent, DialogTitle, InputAdornment, InputBase, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { conversationMatches } from "./ConversationList";
import { type ChatMessage, conversationStatusKey, type ConversationSummary, type Project } from "./types";

interface SearchEntry {
  readonly conversation: ConversationSummary;
  readonly projectName?: string;
}

/**
 * ConversationSearch — a focused popup for finding a conversation across all
 * projects and chats (replaces the inline sidebar search). Typing filters the
 * list; an empty result states whether there are no matches or no conversations.
 */
export function ConversationSearch({
  open,
  projects,
  chats,
  threads,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly threads: Readonly<Record<string, readonly ChatMessage[]>>;
  readonly onClose: () => void;
  readonly onSelect: (id: string) => void;
}) {
  const { t, conversationStatus } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  // Focus the field once the dialog transition settles. Doing it on `onEntered`
  // (rather than `autoFocus`) wins against the Dialog focus-trap, which was
  // leaving the input unfocused on open.
  const focusInput = () => inputRef.current?.focus();

  const entries = useMemo<readonly SearchEntry[]>(
    () => [
      ...projects.flatMap((project) => project.conversations.map((conversation) => ({ conversation, projectName: project.name }))),
      ...chats.map((conversation) => ({ conversation })),
    ],
    [projects, chats],
  );
  const q = query.trim().toLowerCase();
  const results = useMemo(() => (q === "" ? entries : entries.filter((entry) => conversationMatches(entry.conversation, q, threads))), [entries, q, threads]);

  const choose = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="conversation-search-title" slotProps={{ transition: { onEntered: focusInput } }}>
      <DialogTitle id="conversation-search-title" sx={{ pb: 1 }}>
        {t("searchConversations")}
      </DialogTitle>
      <DialogContent sx={{ pb: 2.5 }}>
        <Stack spacing={1.5}>
          <InputBase
            inputRef={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchConversationsPlaceholder")}
            startAdornment={
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              </InputAdornment>
            }
            sx={{
              width: "100%",
              px: 1.25,
              py: 0.75,
              fontSize: "0.85rem",
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              backgroundColor: (theme) => theme.custom.surfaces.s3,
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            }}
          />
          {results.length > 0 ? (
            <Stack spacing={0.5} sx={{ maxHeight: 360, overflowY: "auto", overflowX: "hidden" }}>
              {results.map(({ conversation, projectName }) => {
                const title = conversation.archived ? t("archivedConversationTitle", { title: conversation.title }) : conversation.title;
                return (
                  <Box
                    key={conversation.id}
                    component="button"
                    type="button"
                    aria-label={title}
                    onClick={() => choose(conversation.id)}
                    sx={{
                      font: "inherit",
                      display: "flex",
                      alignItems: "center",
                      gap: 1.25,
                      width: "100%",
                      minWidth: 0,
                      textAlign: "left",
                      px: 1.25,
                      py: 1,
                      cursor: "pointer",
                      border: 0,
                      borderRadius: (theme) => `${theme.custom.radii.md}px`,
                      backgroundColor: (theme) => theme.custom.surfaces.s2,
                      opacity: conversation.archived ? 0.58 : 1,
                      transition: "background-color 120ms ease, opacity 120ms ease",
                      "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3, opacity: 1 },
                      "&:focus-visible": { outline: (theme) => `2px solid ${theme.custom.borders.focus}`, outlineOffset: "-2px", opacity: 1 },
                    }}
                  >
                    <AgentMonogram agent={conversation.agent} size={26} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: "0.84rem", fontWeight: 600, color: "text.primary" }}>
                        {title}
                      </Typography>
                      <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
                        {projectName ? `${projectName} · ${conversation.snippet}` : conversation.snippet}
                      </Typography>
                    </Box>
                    <StatusDot status={conversationStatusKey[conversation.status]} label={conversationStatus(conversation.status)} pulse={conversation.status === "running"} size="sm" />
                  </Box>
                );
              })}
            </Stack>
          ) : (
            <Typography sx={{ py: 3, textAlign: "center", color: "text.secondary", fontSize: "0.82rem" }}>
              {entries.length === 0 ? t("noConversationsYet") : t("noMatches")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
