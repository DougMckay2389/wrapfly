import type { Metadata } from "next";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { MirrorProgressClient } from "./mirror-progress-client";

export const metadata: Metadata = {
  title: "Mirror progress",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type CategoryProgress = {
  top_slug: string;
  top_name: string;
  total: number;
  with_images: number;
  missing_images: number;
};

export default async function MirrorProgressPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("get_mirror_progress");

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mirror progress</h1>
        <p className="text-[var(--color-danger)] mt-4">
          Failed to load: {error.message}
        </p>
      </div>
    );
  }

  return <MirrorProgressClient initial={(data ?? []) as CategoryProgress[]} />;
}
