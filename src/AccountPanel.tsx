import { Check, Clock3, ExternalLink, LoaderCircle, LogOut, RefreshCw, UserRound, X } from "lucide-react";
import type { AccountJob, AuroraUser } from "./auth";

type AccountPanelProps = {
  open: boolean;
  configured: boolean;
  user: AuroraUser | null;
  jobs: AccountJob[];
  loading: boolean;
  pendingEnhancement: boolean;
  onClose: () => void;
  onGoogle: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onOpenResult: (job: AccountJob) => void;
};

function jobTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AccountPanel({
  open,
  configured,
  user,
  jobs,
  loading,
  pendingEnhancement,
  onClose,
  onGoogle,
  onRefresh,
  onSignOut,
  onOpenResult,
}: AccountPanelProps) {
  if (!open) return null;
  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "AuroraAI user";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;

  return (
    <div className="account-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="account-panel" role="dialog" aria-modal="true" aria-label={user ? "AuroraAI account" : "Sign in to AuroraAI"}>
        <button className="account-close" type="button" onClick={onClose} aria-label="Close account panel"><X size={17} /></button>
        {!user ? (
          <div className="signin-view">
            <span className="account-emblem"><UserRound size={24} /></span>
            <span className="account-kicker">AURORAAI ACCOUNT</span>
            <h2>{pendingEnhancement ? <>Your image is ready.<br /><em>Sign in to reveal it.</em></> : <>Your work,<br /><em>always in view.</em></>}</h2>
            <p>{pendingEnhancement ? "AuroraAI finished processing in the background. Sign in securely to claim and view this result." : "Sign in to keep enhancement progress and recent scene jobs attached to your account."}</p>
            {configured ? (
              <div className="provider-list">
                <button type="button" onClick={onGoogle}><span className="google-mark">G</span><strong>Continue with Google</strong></button>
              </div>
            ) : (
              <div className="auth-not-configured">Add the Supabase URL and publishable key to <code>.env.local</code> to enable sign-in.</div>
            )}
            <small className="signin-note">Authentication is handled by Supabase. AuroraAI never receives your Google or Microsoft password.</small>
          </div>
        ) : (
          <div className="account-view">
            <header className="account-profile">
              {avatar ? <img src={avatar} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
              <div><small>Signed in</small><strong>{name}</strong><p>{user.email}</p></div>
              <button type="button" onClick={onSignOut} title="Sign out"><LogOut size={15} /></button>
            </header>
            <div className="account-jobs-heading">
              <div><span>Enhancement activity</span><small>Latest 30 account jobs</small></div>
              <button type="button" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14} /></button>
            </div>
            <div className="account-job-list">
              {loading && !jobs.length ? (
                <div className="account-empty"><LoaderCircle className="spin" size={22} /><span>Loading your workspace…</span></div>
              ) : !jobs.length ? (
                <div className="account-empty"><Clock3 size={22} /><strong>No enhancements yet</strong><span>Your first signed-in job will appear here.</span></div>
              ) : jobs.map((job) => (
                <article className="account-job" key={job.id}>
                  <span className={`job-state state-${job.status}`}>
                    {job.status === "completed" ? <Check size={12} /> : job.status === "processing" || job.status === "queued" ? <LoaderCircle className="spin" size={12} /> : <X size={12} />}
                  </span>
                  <div>
                    <span><strong>{job.source_count} {job.source_count === 1 ? "image" : "images"}</strong><time>{jobTime(job.created_at)}</time></span>
                    <p>{job.status === "failed" ? job.detail || "Enhancement failed" : job.status === "completed" ? "Enhancement completed" : job.stage || "Waiting for AuroraAI"}</p>
                    <small title={job.source_filenames.join(", ")}>{job.source_filenames.join(", ")}</small>
                  </div>
                  {job.status === "completed" && job.result && (
                    <button type="button" onClick={() => onOpenResult(job)} title="Open result"><ExternalLink size={14} /></button>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
