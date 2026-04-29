import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-component / route-handler helpers for auth + role gating.
 */

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser(redirectTo = "/account/sign-in") {
  const user = await getUser();
  if (!user) redirect(redirectTo);
  return user;
}

export async function getProfile() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, company, is_admin, marketing_opt_in")
    .eq("id", user.id)
    .maybeSingle();
  return profile;
}

export async function requireAdmin(redirectTo = "/account/sign-in") {
  const profile = await getProfile();
  if (!profile?.is_admin) redirect(redirectTo);
  return profile;
}
