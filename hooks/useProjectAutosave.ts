"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { buildProjectSnapshot, useEditorStore } from "@/hooks/useEditorStore";
import type { Project } from "@/types";

const SAVE_DELAY_MS = 1_200;
const MAX_RETRY_DELAY_MS = 30_000;

interface PendingSave {
  projectId: string;
  revision: number;
  snapshot: Project;
}

/**
 * Debounced, serialized project saving.
 *
 * Only one request is allowed in flight. If an edit happens while that
 * request is running, the newest snapshot is queued and saved immediately
 * afterward so an older response can never overwrite a newer edit.
 */
export function useProjectAutosave({
  projectId,
  revision,
  enabled,
}: {
  projectId: string;
  revision: number;
  enabled: boolean;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingSave | null>(null);
  const inFlightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const savePendingRef = useRef<() => void>(() => {});

  const clearTimer = (ref: MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = null;
  };

  const scheduleRetry = useCallback(() => {
    clearTimer(retryRef);
    retryAttemptRef.current += 1;
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      4_000 * 2 ** Math.min(3, retryAttemptRef.current - 1)
    );
    retryRef.current = setTimeout(() => savePendingRef.current(), delay);
  }, []);

  const captureLatest = useCallback((): PendingSave | null => {
    const state = useEditorStore.getState();
    if (!enabled || state.projectId !== projectId || state.revision === 0) return null;

    const syncing = state.media.some(
      (asset) => asset.uploadState && asset.uploadState !== "ready"
    );
    if (syncing) {
      state.setSaveState(
        state.media.some((asset) => asset.uploadState === "error") ? "error" : "saving"
      );
      return null;
    }

    return {
      projectId: state.projectId,
      revision: state.revision,
      snapshot: buildProjectSnapshot(state),
    };
  }, [enabled, projectId]);

  const queueLatest = useCallback(() => {
    const next = captureLatest();
    if (!next) return;
    pendingRef.current = next;
    useEditorStore.getState().setSaveState("saving");
    savePendingRef.current();
  }, [captureLatest]);

  useEffect(() => {
    savePendingRef.current = () => {
      if (inFlightRef.current || !pendingRef.current) return;
      const pending = pendingRef.current;
      pendingRef.current = null;
      inFlightRef.current = true;

      let failed = false;
      void fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.snapshot),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? "Projektet kunde inte sparas.");
          }
          retryAttemptRef.current = 0;
          clearTimer(retryRef);
          const state = useEditorStore.getState();
          if (
            state.projectId === pending.projectId &&
            state.revision <= pending.revision &&
            !pendingRef.current
          ) {
            state.setSaveState("saved");
          }
        })
        .catch(() => {
          failed = true;
          const state = useEditorStore.getState();
          if (state.projectId === pending.projectId) {
            state.setSaveState("error");
            const latest = captureLatest();
            if (latest) pendingRef.current = latest;
            else pendingRef.current ??= pending;
            scheduleRetry();
          }
        })
        .finally(() => {
          inFlightRef.current = false;
          if (pendingRef.current && !failed) savePendingRef.current();
        });
    };
  }, [captureLatest, scheduleRetry]);

  useEffect(() => {
    clearTimer(debounceRef);
    if (!enabled || revision === 0) return;
    useEditorStore.getState().setSaveState("saving");
    debounceRef.current = setTimeout(queueLatest, SAVE_DELAY_MS);
    return () => clearTimer(debounceRef);
  }, [enabled, projectId, queueLatest, revision]);

  useEffect(() => {
    pendingRef.current = null;
    retryAttemptRef.current = 0;
    clearTimer(debounceRef);
    clearTimer(retryRef);
  }, [projectId]);

  useEffect(() => {
    const onOnline = () => {
      clearTimer(retryRef);
      queueLatest();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queueLatest]);

  useEffect(() => {
    const saveBeforeBackgrounding = () => {
      if (document.visibilityState !== "hidden") return;
      clearTimer(debounceRef);
      queueLatest();
    };
    document.addEventListener("visibilitychange", saveBeforeBackgrounding);
    return () => document.removeEventListener("visibilitychange", saveBeforeBackgrounding);
  }, [queueLatest]);

  useEffect(
    () => () => {
      clearTimer(debounceRef);
      clearTimer(retryRef);
    },
    []
  );

  return useCallback(() => {
    clearTimer(debounceRef);
    clearTimer(retryRef);
    queueLatest();
  }, [queueLatest]);
}
