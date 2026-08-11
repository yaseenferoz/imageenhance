import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { EnhanceResponse } from "./api";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");

export const authConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const supabase = authConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type AuroraSession = Session;
export type AuroraUser = User;

export type AccountJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string | null;
  detail: string | null;
  source_count: number;
  source_filenames: string[];
  result: EnhanceResponse | null;
  created_at: string;
  updated_at: string;
};

export async function signInWithGoogle() {
  if (!supabase) throw new Error("Supabase authentication is not configured.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: configuredSiteUrl || window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
}

export async function loadAccountJobs(): Promise<AccountJob[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("enhancement_jobs")
    .select("id,status,stage,detail,source_count,source_filenames,result,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as AccountJob[];
}
