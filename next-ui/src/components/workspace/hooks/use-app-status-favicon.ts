import { useEffect, useRef } from "react";
import { workspaceAttentionFaviconHref, type WorkspaceAttentionStatus } from "../models/workspace-attention-status-model";

interface FaviconSnapshot {
  readonly link: HTMLLinkElement | null;
  readonly href: string | null;
  readonly type: string | null;
}

function findFaviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
}

function ensureFaviconLink(): HTMLLinkElement {
  const existing = findFaviconLink();
  if (existing) {
    return existing;
  }
  const created = document.createElement("link");
  created.rel = "icon";
  document.head.appendChild(created);
  return created;
}

function restoreFavicon(snapshot: FaviconSnapshot): void {
  const current = findFaviconLink();
  if (snapshot.link) {
    const target = current ?? snapshot.link;
    target.rel = "icon";
    if (snapshot.href == null) {
      target.removeAttribute("href");
    } else {
      target.setAttribute("href", snapshot.href);
    }
    if (snapshot.type == null) {
      target.removeAttribute("type");
    } else {
      target.setAttribute("type", snapshot.type);
    }
    if (!target.parentElement) {
      document.head.appendChild(target);
    }
    return;
  }
  current?.remove();
}

export function useAppStatusFavicon(status: WorkspaceAttentionStatus | null, reduceMotion: boolean): void {
  const initialFaviconRef = useRef<FaviconSnapshot | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (!initialFaviconRef.current) {
      const link = findFaviconLink();
      initialFaviconRef.current = {
        link,
        href: link?.getAttribute("href") ?? null,
        type: link?.getAttribute("type") ?? null,
      };
    }

    const initial = initialFaviconRef.current;
    if (!status) {
      restoreFavicon(initial);
      return;
    }

    const link = ensureFaviconLink();
    link.setAttribute("type", "image/svg+xml");
    link.setAttribute("href", workspaceAttentionFaviconHref(status, !reduceMotion));
  }, [reduceMotion, status]);

  useEffect(() => {
    return () => {
      if (initialFaviconRef.current) {
        restoreFavicon(initialFaviconRef.current);
      }
    };
  }, []);
}
