import { useEffect, useMemo, useState, type ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ScheduleSendRoundedIcon from "@mui/icons-material/ScheduleSendRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import { Box, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import type { PendingQueueItem, PendingQueueMessageItem, PendingQueueWakeupItem } from "../../../client/api/workspace-page-api";
import { useI18n } from "../../../i18n/I18nProvider";
import { pendingQueueWakeupDetail, pendingQueueWakeupQueueLabel } from "../../workspace/models/workspace-composer-model";
import { Button, IconButton, Tooltip } from "../../ui";
import { WakeupDetailsPopover } from "../composer/WakeupTile";
import type { ChatMessage } from "../core/types";

export interface QueuedMessagesProps {
  readonly messages: readonly ChatMessage[];
  readonly items?: readonly PendingQueueItem[];
  readonly paused: boolean;
  readonly onCancel: (messageId: string) => void;
  readonly onCancelItem?: (itemId: string) => void;
  readonly onCopy: (message: ChatMessage) => void;
  readonly onEdit?: (item: PendingQueueMessageItem) => void;
  readonly onSendNow: () => void;
  readonly onTogglePause: () => void;
  readonly onMoveItemAfter?: (itemId: string, afterItemId: string | null) => void;
}

const queuedActionButtonSx = {
  flex: "0 0 auto",
  width: 22,
  height: 22,
  color: "text.secondary",
} as const;

const queuedHeaderButtonSx = {
  minWidth: { xs: 28, sm: 0 },
  width: { xs: 28, sm: "auto" },
  height: { xs: 28, sm: 26 },
  px: { xs: 0, sm: 1 },
  color: "text.secondary",
  whiteSpace: "nowrap",
  lineHeight: 1.15,
  "& .MuiButton-startIcon": {
    margin: { xs: 0, sm: "0 6px 0 -2px" },
  },
  "& .queued-header-button-label": {
    display: { xs: "none", sm: "inline" },
  },
} as const;

const QUEUED_VISIBLE_ROW_COUNT = 5;
const QUEUED_ROW_HEIGHT_PX = 30;

function messageItems(messages: readonly ChatMessage[]): readonly PendingQueueItem[] {
  return messages.map((message, index) => ({
    id: message.id,
    conversationId: "",
    position: index,
    kind: "message" as const,
    createdAtMs: message.createdAtMs ?? 0,
    updatedAtMs: message.createdAtMs ?? 0,
    state: "queued" as const,
    message,
    origin: "",
  }));
}

function queueItemText(item: PendingQueueItem, emptyText: string, locale: ReturnType<typeof useI18n>["locale"]): string {
  if (item.kind === "message") {
    return (item.message.text ?? "").trim() || emptyText;
  }
  if (item.kind === "goal") {
    return item.description;
  }
  return pendingQueueWakeupQueueLabel(item, locale);
}

function QueueItemIcon({ item, index }: { readonly item: PendingQueueItem; readonly index: number }) {
  if (item.kind === "goal" && item.state === "dispatching") {
    return <ScheduleSendRoundedIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.info.main }} />;
  }
  if (item.kind === "goal") {
    return <FlagRoundedIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.info.main }} />;
  }
  if (item.kind === "wakeup") {
    return <AccessTimeRoundedIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.warn.main }} />;
  }
  return <>{index + 1}</>;
}

function queueItemCancelLabel(item: PendingQueueItem, t: ReturnType<typeof useI18n>["t"]): string {
  if (item.kind === "goal") {
    return t("cancelQueuedGoal");
  }
  if (item.kind === "wakeup") {
    return t("cancelQueuedWakeup");
  }
  return t("cancelQueuedMessage");
}

function queueItemStatusLabel(item: PendingQueueItem, nowMs: number, queuePaused: boolean, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (item.kind !== "goal") {
    return null;
  }
  if (item.state === "dispatching") {
    return t("queuedGoalActive");
  }
  if (queuePaused || item.state === "paused") {
    return t("queuedGoalPaused");
  }
  if (item.state === "queued" && item.nextDispatchAtMs !== undefined && item.nextDispatchAtMs > nowMs) {
    return t("queuedGoalWaiting", { seconds: Math.max(1, Math.ceil((item.nextDispatchAtMs - nowMs) / 1_000)) });
  }
  return null;
}

function queueCanSendNow(items: readonly PendingQueueItem[]): boolean {
  if (items.some((item) => item.kind === "wakeup" && item.state === "waiting_wakeup")) {
    return false;
  }
  return items.some((item) => (item.kind === "message" || item.kind === "goal") && item.state === "queued");
}

interface QueueItemRowProps {
  readonly dragHandle?: ReactNode;
  readonly index: number;
  readonly item: PendingQueueItem;
  readonly onCancel: (messageId: string) => void;
  readonly onCancelItem?: (itemId: string) => void;
  readonly onCopy: (message: ChatMessage) => void;
  readonly onEdit?: (item: PendingQueueMessageItem) => void;
  readonly onOpenWakeup: (item: PendingQueueWakeupItem, anchor: HTMLElement) => void;
  readonly paused: boolean;
  readonly rowRef?: (node: HTMLDivElement | null) => void;
  readonly rowSx?: SxProps<Theme>;
  readonly showDragColumn: boolean;
}

function QueueItemRow({
  dragHandle,
  index,
  item,
  onCancel,
  onCancelItem,
  onCopy,
  onEdit,
  onOpenWakeup,
  paused,
  rowRef,
  rowSx,
  showDragColumn,
}: QueueItemRowProps) {
  const { locale, t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (item.kind !== "goal" || item.state !== "queued" || item.nextDispatchAtMs === undefined) {
      return undefined;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [item.kind, item.nextDispatchAtMs, item.state]);
  const isWakeup = item.kind === "wakeup";
  const cancelLabel = queueItemCancelLabel(item, t);
  const statusLabel = queueItemStatusLabel(item, nowMs, paused, t);
  const openWakeupFromRow = (target: HTMLElement) => {
    if (item.kind === "wakeup") {
      onOpenWakeup(item, target);
    }
  };
  return (
    <Stack
      ref={rowRef}
      data-testid={`queued-item-${item.id}`}
      direction="row"
      spacing={0.75}
      role={isWakeup ? "button" : undefined}
      tabIndex={isWakeup ? 0 : undefined}
      onClick={(event) => openWakeupFromRow(event.currentTarget)}
      onKeyDown={(event) => {
        if (!isWakeup || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        openWakeupFromRow(event.currentTarget);
      }}
      sx={{
        alignItems: "center",
        minHeight: QUEUED_ROW_HEIGHT_PX,
        px: 0.75,
        py: 0.25,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        cursor: isWakeup ? "pointer" : "default",
        "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 },
        "& .queued-actions": { opacity: 0, transition: "opacity 120ms ease", "@media (hover: none)": { opacity: 1 } },
        "&:hover .queued-actions, &:focus-within .queued-actions": { opacity: 1 },
        ...rowSx,
      }}
    >
      {showDragColumn ? (
        dragHandle ?? <Box component="span" aria-hidden sx={{ flex: "0 0 auto", width: 14, height: 14 }} />
      ) : null}
      <Box
        component="span"
        sx={{
          flex: "0 0 auto",
          width: 17,
          height: 17,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "999px",
          fontFamily: (theme) => theme.custom.fonts.mono,
          fontSize: "0.6rem",
          fontWeight: 700,
          color: "text.secondary",
          backgroundColor: (theme) => theme.custom.surfaces.s3,
        }}
      >
        <QueueItemIcon item={item} index={index} />
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ flex: 1, minWidth: 0, alignItems: "center" }}>
        <Typography
          sx={{ flex: "1 1 auto", minWidth: 0, fontSize: "0.8rem", color: "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {queueItemText(item, t("queuedEmptyTurn"), locale)}
        </Typography>
      </Stack>
      <Stack className="queued-actions" direction="row" spacing={0.25} sx={{ flex: "0 0 auto", alignItems: "center" }}>
        {statusLabel ? (
          <Box
            component="span"
            sx={{
              flex: "0 0 auto",
              height: 18,
              px: 0.5,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: (theme) => `${theme.custom.radii.sm}px`,
              fontSize: "0.62rem",
              fontWeight: 700,
              color: (theme) => theme.palette.status.info.main,
              backgroundColor: (theme) => theme.palette.status.info.soft,
            }}
          >
            {statusLabel}
          </Box>
        ) : null}
        {item.kind === "message" ? (
          <>
            {item.state === "queued" && onEdit ? (
              <Tooltip title={t("editQueuedMessage")}>
                <IconButton
                  aria-label={t("editQueuedMessage")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(item);
                  }}
                  sx={{ ...queuedActionButtonSx, "&:hover": { color: "text.primary", backgroundColor: (theme) => theme.custom.surfaces.s4 } }}
                >
                  <EditRoundedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={t("copyQueuedMessage")}>
              <IconButton
                aria-label={t("copyQueuedMessage")}
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(item.message);
                }}
                sx={{ ...queuedActionButtonSx, "&:hover": { color: "text.primary", backgroundColor: (theme) => theme.custom.surfaces.s4 } }}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </>
        ) : null}
        <Tooltip title={cancelLabel}>
          <IconButton
            aria-label={cancelLabel}
            onClick={(event) => {
              event.stopPropagation();
              if (onCancelItem) {
                onCancelItem(item.id);
              } else if (item.kind === "message") {
                onCancel(item.message.id);
              }
            }}
            sx={{ ...queuedActionButtonSx, "&:hover": { color: (theme) => theme.palette.status.error.main, backgroundColor: (theme) => theme.custom.surfaces.s4 } }}
          >
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

function SortableQueueItemRow(props: Omit<QueueItemRowProps, "dragHandle" | "rowRef" | "rowSx">) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
  const { t } = useI18n();
  return (
    <QueueItemRow
      {...props}
      rowRef={setNodeRef}
      rowSx={{
        opacity: isDragging ? 0.55 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : 1,
      }}
      dragHandle={
        <Box
          component="span"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("moveQueuedItem")}
          sx={{ flex: "0 0 auto", width: 14, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "text.disabled", cursor: "grab", touchAction: "none" }}
        >
          <DragIndicatorRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
      }
    />
  );
}

/**
 * The list of user turns waiting for the active run to finish, docked just above
 * the composer. Wakes are pinned at the top as queue blockers; message/goal
 * rows are sortable through dnd-kit and can never move above wakeups.
 */
export function QueuedMessages({ messages, items, paused, onCancel, onCancelItem, onCopy, onEdit, onSendNow, onTogglePause, onMoveItemAfter }: QueuedMessagesProps) {
  const { locale, t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const queueItems = items && items.length > 0 ? items : messageItems(messages);
  const hasWaitingGoal = queueItems.some((item) => item.kind === "goal" && item.state === "queued" && item.nextDispatchAtMs !== undefined && item.nextDispatchAtMs > nowMs);
  useEffect(() => {
    if (!hasWaitingGoal) {
      return undefined;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasWaitingGoal]);
  const wakeupItems = useMemo(() => queueItems.filter((item): item is PendingQueueWakeupItem => item.kind === "wakeup"), [queueItems]);
  const activeItems = useMemo(() => queueItems.filter((item) => item.kind !== "wakeup" && item.state === "dispatching"), [queueItems]);
  const movableItems = useMemo(() => queueItems.filter((item) => item.kind !== "wakeup" && item.state !== "dispatching"), [queueItems]);
  const movableIds = useMemo(() => movableItems.map((item) => item.id), [movableItems]);
  const [wakeupAnchorEl, setWakeupAnchorEl] = useState<HTMLElement | null>(null);
  const [openWakeupId, setOpenWakeupId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (queueItems.length === 0) {
    return null;
  }
  const scrollable = queueItems.length > QUEUED_VISIBLE_ROW_COUNT;
  const showDragColumn = Boolean(onMoveItemAfter && movableItems.length > 1);
  const waitingWakeup = wakeupItems.some((item) => item.state === "waiting_wakeup");
  const title = waitingWakeup
    ? t("queuedWakeupWaitingTitle", { count: queueItems.length })
    : hasWaitingGoal && !paused
      ? t("queuedGoalWaitingTitle", { count: queueItems.length })
      : paused
        ? t("queuedPausedTitle", { count: queueItems.length })
        : t("queuedTitle", { count: queueItems.length });
  const openedWakeup = openWakeupId ? wakeupItems.find((item) => item.id === openWakeupId) ?? null : null;
  const canSendNow = queueCanSendNow(queueItems);
  const handleDragEnd = (event: DragEndEvent) => {
    if (!onMoveItemAfter || !event.over || event.active.id === event.over.id) {
      return;
    }
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const oldIndex = movableIds.indexOf(activeId);
    const newIndex = movableIds.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const nextIds = arrayMove(movableIds, oldIndex, newIndex);
    const afterIndex = nextIds.indexOf(activeId) - 1;
    onMoveItemAfter(activeId, afterIndex >= 0 ? nextIds[afterIndex] : null);
  };

  return (
    <Box
      data-testid="queued-messages"
      sx={{
        width: "100%",
        borderRadius: (theme) => `${theme.custom.radii.lg}px`,
        border: (theme) => `1px solid ${theme.custom.borders.strong}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        boxShadow: "0 -10px 28px rgba(0, 0, 0, 0.3)",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr) 28px 28px", sm: "minmax(0, 1fr) auto auto" },
          gridTemplateAreas: '"title pause send"',
          alignItems: "center",
          columnGap: { xs: 0.35, sm: 0.5 },
          px: { xs: 1, sm: 1.25 },
          py: { xs: 0.45, sm: 0.35 },
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ gridArea: "title", alignItems: "center", minWidth: 0, alignSelf: "center" }}>
          <ScheduleSendRoundedIcon data-testid="queued-header-schedule-icon" sx={{ fontSize: 14, color: (theme) => theme.palette.status.warn.main, flex: "0 0 auto" }} />
          <Typography variant="microLabel" noWrap sx={{ color: "text.secondary", minWidth: 0 }}>
            {title}
          </Typography>
        </Stack>
        <Button
          variant="text"
          size="small"
          onClick={onTogglePause}
          aria-label={paused ? t("resumeQueue") : t("pauseQueue")}
          startIcon={paused ? <PlayArrowRoundedIcon sx={{ fontSize: 16 }} /> : <PauseRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{
            ...queuedHeaderButtonSx,
            gridArea: "pause",
            justifySelf: { xs: "end", sm: "start" },
            alignSelf: "center",
          }}
        >
          <Box component="span" className="queued-header-button-label">
            {paused ? t("resumeQueue") : t("pauseQueue")}
          </Box>
        </Button>
        <Button
          variant="text"
          size="small"
          onClick={onSendNow}
          disabled={!canSendNow}
          aria-label={t("sendQueuedNow")}
          startIcon={<SendRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{
            ...queuedHeaderButtonSx,
            gridArea: "send",
            justifySelf: "end",
            alignSelf: "center",
          }}
        >
          <Box component="span" className="queued-header-button-label">
            {t("sendQueuedNow")}
          </Box>
        </Button>
      </Box>
      <Stack
        data-testid="queued-messages-list"
        data-scrollable={scrollable ? "true" : undefined}
        sx={{
          px: 0.5,
          py: 0.25,
          maxHeight: scrollable ? QUEUED_VISIBLE_ROW_COUNT * QUEUED_ROW_HEIGHT_PX : "none",
          overflowY: scrollable ? "auto" : "visible",
          overscrollBehavior: "contain",
          scrollbarGutter: scrollable ? "stable" : "auto",
        }}
      >
        {wakeupItems.map((item, index) => (
          <QueueItemRow
            key={item.id}
            index={index}
            item={item}
            onCancel={onCancel}
            onCancelItem={onCancelItem}
            onCopy={onCopy}
            onEdit={onEdit}
            onOpenWakeup={(wakeup, anchor) => {
              setOpenWakeupId(wakeup.id);
              setWakeupAnchorEl(anchor);
            }}
            paused={paused}
            showDragColumn={showDragColumn}
          />
        ))}
        {activeItems.map((item, index) => (
          <QueueItemRow
            key={item.id}
            index={wakeupItems.length + index}
            item={item}
            onCancel={onCancel}
            onCancelItem={onCancelItem}
            onCopy={onCopy}
            onEdit={onEdit}
            onOpenWakeup={(wakeup, anchor) => {
              setOpenWakeupId(wakeup.id);
              setWakeupAnchorEl(anchor);
            }}
            paused={paused}
            showDragColumn={showDragColumn}
          />
        ))}
        {onMoveItemAfter ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={movableIds} strategy={verticalListSortingStrategy}>
              {movableItems.map((item, index) => (
                <SortableQueueItemRow
                  key={item.id}
                  index={wakeupItems.length + activeItems.length + index}
                  item={item}
                  onCancel={onCancel}
                  onCancelItem={onCancelItem}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onOpenWakeup={(wakeup, anchor) => {
                    setOpenWakeupId(wakeup.id);
                    setWakeupAnchorEl(anchor);
                  }}
                  paused={paused}
                  showDragColumn={showDragColumn}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          movableItems.map((item, index) => (
            <QueueItemRow
              key={item.id}
              index={wakeupItems.length + activeItems.length + index}
              item={item}
              onCancel={onCancel}
              onCancelItem={onCancelItem}
              onCopy={onCopy}
              onEdit={onEdit}
              onOpenWakeup={(wakeup, anchor) => {
                setOpenWakeupId(wakeup.id);
                setWakeupAnchorEl(anchor);
              }}
              paused={paused}
              showDragColumn={showDragColumn}
            />
          ))
        )}
      </Stack>
      {openedWakeup ? (
        <WakeupDetailsPopover
          anchorEl={wakeupAnchorEl}
          detail={pendingQueueWakeupDetail(openedWakeup, locale)}
          id={openedWakeup.id}
          onClose={() => {
            setWakeupAnchorEl(null);
            setOpenWakeupId(null);
          }}
          testIdPrefix="queued-wakeup"
        />
      ) : null}
    </Box>
  );
}
