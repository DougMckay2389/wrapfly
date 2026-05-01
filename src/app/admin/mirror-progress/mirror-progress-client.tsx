"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { CategoryProgress } from "./page";

type RecentEvent = {
  id: string;
  productId: string;
  name: string | null;
  imageCount: number;
  at: number;
};

type SyncResult = {
  ok: boolean;
  rowsRead?: number;
  rowsSkipped?: number;
  variantsTouched?: number;
  variantsUnchanged?: number;
  variantsNotFound?: number;
  productsTouched?: number;
  elapsedMs?: number;
  error?: string;
};

const REFETCH_INTERVAL_MS = 10_000;
const MAX_FEED = 50;
const SYNC_FUNCTION_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") +
  "/functions/v1/sync-grimco-sheet";

export function MirrorProgressClient({
  initial,
}: {
  initial: CategoryProgress[];
}) {
  const [progress, setProgress] = useState<CategoryProgress[]>(initial);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ at: number; result: SyncResult } | null>(
    null,
  );
  // Force a re-render every 10 s so "Xs ago" labels update.
  const [, setTick] = useState(0);
  const refetchTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch(SYNC_FUNCTION_URL, { method: "POST" });
      const result = (await r.json()) as SyncResult;
      setLastSync({ at: Date.now(), result });
    } catch (e) {
      setLastSync({
        at: Date.now(),
        result: { ok: false, error: String(e) },
      });
    } finally {
      setSyncing(false);
    }
  }

  // 1) Realtime subscription: log every product UPDATE that ends up with images.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-mirror-progress")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products" },
        (payload) => {
          const row = payload.new as {
            id?: string;
            name?: string | null;
            images?: unknown;
          };
          const images = Array.isArray(row.images) ? row.images : null;
          if (!images || images.length === 0) return;
          const ev: RecentEvent = {
            id: `${row.id ?? "unknown"}-${Date.now()}`,
            productId: row.id ?? "",
            name: row.name ?? null,
            imageCount: images.length,
            at: Date.now(),
          };
          setEvents((prev) => [ev, ...prev].slice(0, MAX_FEED));
          setSessionCount((c) => c + 1);
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 2) Refetch per-category counts every 10 s for accurate progress bars.
  useEffect(() => {
    const supabase = createClient();
    const tick = async () => {
      const { data } = await supabase.rpc("get_mirror_progress");
      if (data) setProgress(data as CategoryProgress[]);
      setTick((t) => t + 1);
    };
    refetchTimer.current = setInterval(tick, REFETCH_INTERVAL_MS);
    return () => {
      if (refetchTimer.current) clearInterval(refetchTimer.current);
    };
  }, []);

  const totals = useMemo(() => {
    let total = 0;
    let withImg = 0;
    for (const r of progress) {
      total += Number(r.total);
      withImg += Number(r.with_images);
    }
    return { total, withImages: withImg, missing: total - withImg };
  }, [progress]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mirror progress</h1>
          <p className="text-[var(--color-muted)] mt-1">
            Live image-mirror activity. Sheet sync runs every 5 minutes; counts
            refresh every 10 s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              connected
                ? "inline-flex items-center gap-2 text-sm text-[var(--color-success)]"
                : "inline-flex items-center gap-2 text-sm text-[var(--color-muted)]"
            }
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? "bg-[color:#22c55e]" : "bg-[var(--color-muted)]"
              }`}
            />
            {connected ? "Realtime connected" : "Connecting…"}
          </span>
          <button
            type="button"
            onClick={triggerSync}
            disabled={syncing}
            className={
              syncing
                ? "px-3 py-1.5 rounded-md text-sm font-semibold bg-[var(--color-brand-300)] text-white cursor-not-allowed"
                : "px-3 py-1.5 rounded-md text-sm font-semibold bg-[var(--color-brand-900)] text-white hover:bg-[var(--color-brand-800)]"
            }
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {lastSync ? (
        <div
          className={
            lastSync.result.ok
              ? "mt-3 text-xs text-[var(--color-muted)]"
              : "mt-3 text-xs text-[var(--color-danger)]"
          }
        >
          Last manual sync {timeAgo(lastSync.at)} —{" "}
          {lastSync.result.ok
            ? `${lastSync.result.rowsRead ?? 0} rows, ${
                lastSync.result.variantsTouched ?? 0
              } variants updated, ${
                lastSync.result.productsTouched ?? 0
              } products updated, ${lastSync.result.variantsNotFound ?? 0} not found (${
                lastSync.result.elapsedMs ?? 0
              } ms)`
            : `error: ${lastSync.result.error ?? "unknown"}`}
        </div>
      ) : null}

      <div className="mt-6 grid sm:grid-cols-4 gap-4">
        <Stat label="This session" value={String(sessionCount)} />
        <Stat label="Catalog total" value={String(totals.total)} />
        <Stat label="With images" value={String(totals.withImages)} />
        <Stat label="Still missing" value={String(totals.missing)} />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">By top-level category</h2>
        {progress.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            No category data yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {progress.map((row) => {
              const total = Number(row.total);
              const withImages = Number(row.with_images);
              const pct = total === 0 ? 0 : Math.round((withImages / total) * 100);
              return (
                <li
                  key={row.top_slug}
                  className="rounded-md border border-[var(--color-border)] p-3"
                >
                  <div className="flex justify-between items-baseline text-sm gap-3">
                    <span className="font-medium truncate">{row.top_name}</span>
                    <span className="text-[var(--color-muted)] shrink-0 tabular-nums">
                      {withImages} / {total} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--color-muted-bg)] overflow-hidden">
                    <div
                      className="h-full bg-[color:#22c55e] transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Nothing yet. The Google-Sheet sync runs every 5 minutes — or hit{" "}
            <strong>Sync now</strong> above to force a fresh poll.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] text-sm">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="py-2 flex justify-between items-center gap-4"
              >
                <Link
                  href={`/admin/products/${ev.productId}`}
                  className="font-medium hover:underline truncate"
                >
                  {ev.name ?? ev.productId}
                </Link>
                <span className="text-[var(--color-muted)] shrink-0 tabular-nums">
                  {ev.imageCount} image{ev.imageCount === 1 ? "" : "s"} ·{" "}
                  {timeAgo(ev.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </p>
      <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
