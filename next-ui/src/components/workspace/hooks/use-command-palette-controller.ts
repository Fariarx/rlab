import { useCallback, useEffect, useMemo, useState } from "react";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: readonly string[];
  readonly action: () => void;
}

export interface CommandPaletteController {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly activeItem: CommandPaletteItem | undefined;
  readonly visibleItems: readonly CommandPaletteItem[];
  readonly listId: string;
  readonly moveActive: (offset: -1 | 1) => void;
  readonly runCommand: (item: CommandPaletteItem) => void;
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

export function useCommandPaletteController({
  open,
  items,
  onClose,
}: {
  readonly open: boolean;
  readonly items: readonly CommandPaletteItem[];
  readonly onClose: () => void;
}): CommandPaletteController {
  const [query, setRawQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalize(query);
  const visibleItems = useMemo(() => items.filter((item) => itemMatches(item, normalizedQuery)), [items, normalizedQuery]);
  const activeItem = visibleItems[activeIndex] ?? visibleItems[0];
  const listId = "command-palette-list";

  const setQuery = useCallback((next: string) => {
    setRawQuery(next);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (open) {
      setRawQuery("");
      setActiveIndex(0);
    }
  }, [open]);

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

  return {
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    activeItem,
    visibleItems,
    listId,
    moveActive,
    runCommand,
  };
}
