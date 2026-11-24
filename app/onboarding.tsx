"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, LibraryBig, MessageSquare, SlidersHorizontal } from "lucide-react";
import type { SetupStatus } from "../lib/onboarding";
import { NavigationIcon } from "./navigation-icon";
import { ImagePicker } from "./media";

const endpoint = "/api/onboarding";
const steps = [
  { title: "Quick tour", description: "Find your way around" },
  { title: "Default persona", description: "Choose who you’ll play" },
  { title: "Local account", description: "Optional password protection" },
];

async function getStatus(response: Response): Promise<SetupStatus> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Dundra could not finish this step.");
  return data;
}

type AccessActions = { error: string; busy: boolean; submit: (body: Record<string, unknown>) => Promise<void> };

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const revision = useRef(0);
  const submitting = useRef(false);

  async function refresh() {
    const current = ++revision.current;
    try {
      const result = await getStatus(await fetch(endpoint, { cache: "no-store" }));
      if (current === revision.current) { setStatus(result); setError(""); }
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof Error ? cause.message : "Could not load Dundra.");
    }
  }

  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    if (typeof BroadcastChannel === "function") {
      channel.current = new BroadcastChannel("dundra-access");
      channel.current.addEventListener("message", update);
    }
    window.addEventListener("dundra:check-access", update);
    window.addEventListener("focus", update);
    return () => {
      revision.current += 1;
      window.removeEventListener("dundra:check-access", update);
      window.removeEventListener("focus", update);
      channel.current?.close();
      channel.current = null;
    };
  }, []);

  async function submit(body: Record<string, unknown>) {
    if (submitting.current) return;
    submitting.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.status === 409 && body.action === "finish") {
        const latest = await getStatus(await fetch(endpoint, { cache: "no-store" }));
        if (latest.stage !== "setup") { setStatus(latest); return; }
      }
      const result = await getStatus(response);
      revision.current += 1;
      setStatus(result);
      channel.current?.postMessage("changed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update access.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (status?.stage === "ready") return children;

  return <main className="welcome-shell">
    {status?.stage === "setup" && <Walkthrough personas={status.personas} busy={busy} error={error} submit={submit} />}
    {status?.stage === "locked" && <SignIn busy={busy} error={error} submit={submit} />}
    {!status && <section className="welcome-card welcome-locked" aria-label="Dundra">
      <Brand />
      {error ? <>
        <p className="error" role="alert">{error}</p>
        <button type="button" className="secondary" onClick={() => void refresh()}>Try again</button>
      </> : <p className="welcome-muted" role="status">Opening Dundra…</p>}
    </section>}
  </main>;
}

function Brand() {
  return <div className="welcome-brand"><NavigationIcon name="brand" /> Dundra</div>;
}

function Walkthrough({ personas, busy, error, submit }: AccessActions & { personas: { id: string; name: string }[] }) {
  const [step, setStep] = useState(0);
  const [personaId, setPersonaId] = useState(personas[0]?.id || "");
  const [personaName, setPersonaName] = useState("");
  const [personaPortrait, setPersonaPortrait] = useState<string | null>(null);
  const [personaDescription, setPersonaDescription] = useState("");
  const [accountName, setAccountName] = useState("");
  const [formError, setFormError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  function move(to: number) {
    setFormError("");
    setStep(to);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function finish(account?: { accountName: string; password: string }) {
    void submit({ action: "finish", personaId, personaName, personaDescription, ...(!personaId && { personaPortrait }), ...account });
  }

  function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== form.get("confirm")) {
      setFormError("The passwords don’t match.");
      return;
    }
    setFormError("");
    finish({ accountName, password });
  }

  const problem = formError || error;
  return <div className="welcome-card welcome-setup">
    <aside className="welcome-rail">
      <Brand />
      <ol className="welcome-steps" aria-label="Setup progress">
        {steps.map((item, index) => <li key={item.title} data-state={index === step ? "current" : index < step ? "done" : "waiting"}
          aria-current={index === step ? "step" : undefined}>
          <button type="button" disabled={busy || index >= step} onClick={() => move(index)}>
            <span className="welcome-step-number" aria-hidden="true">{index < step ? <Check size={15} /> : index + 1}</span>
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>
        </li>)}
      </ol>
    </aside>
    <section className="welcome-content" aria-labelledby="welcome-heading">
      {step === 0 && <>
        <div key="tour" className="welcome-pane">
          <h1 id="welcome-heading" ref={heading} tabIndex={-1}>Welcome to Dundra</h1>
          <p className="welcome-muted">Here’s where to get your first story going.</p>
          <dl className="welcome-tour">
            <div><dt><LibraryBig size={18} aria-hidden="true" /> Library</dt><dd>Create a character or bring a card in through Import &amp; export.</dd></div>
            <div><dt><SlidersHorizontal size={18} aria-hidden="true" /> Model settings</dt><dd>Connect an OpenAI-compatible model before sending your first reply.</dd></div>
            <div><dt><MessageSquare size={18} aria-hidden="true" /> Chats</dt><dd>Start a story from a character’s card and pick it up later in Chats.</dd></div>
          </dl>
        </div>
        <footer className="welcome-actions"><button type="button" className="primary" onClick={() => move(1)}>Set up my persona <ArrowRight size={16} aria-hidden="true" /></button></footer>
      </>}
      {step === 1 && <form className="welcome-flow" onSubmit={event => {
        event.preventDefault();
        if (personaId || personaName.trim()) move(2);
      }}>
        <div className="welcome-pane">
          <h1 id="welcome-heading" ref={heading} tabIndex={-1}>Who will you play?</h1>
          <p className="welcome-muted">Dundra will suggest this persona for new chats. You can change it later in Personas.</p>
          <div className="welcome-fields">
            {personas.length > 0 && <label>Persona<select value={personaId} onChange={event => setPersonaId(event.target.value)}>
              {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
              <option value="">Create a new persona</option>
            </select></label>}
            {!personaId && <>
              <div className="persona-identity welcome-persona">
                <ImagePicker avatar label="Persona avatar" src={personaPortrait} change={setPersonaPortrait} />
                <label>Persona name<input autoComplete="off" maxLength={80} required value={personaName}
                  onChange={event => setPersonaName(event.target.value)} placeholder="e.g. Rowan" /></label>
              </div>
              <label><span>Description <span className="welcome-optional">(optional)</span></span>
                <textarea rows={3} maxLength={4000} value={personaDescription} placeholder="What should the character know about you?"
                  onChange={event => setPersonaDescription(event.target.value)} /></label>
            </>}
          </div>
        </div>
        <footer className="welcome-actions">
          <button type="button" className="quiet welcome-back" onClick={() => move(0)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          <button className="primary" disabled={!personaId && !personaName.trim()}>Continue <ArrowRight size={16} aria-hidden="true" /></button>
        </footer>
      </form>}
      {step === 2 && <form className="welcome-flow" onSubmit={createAccount}>
        <div className="welcome-pane">
          <h1 id="welcome-heading" ref={heading} tabIndex={-1}>Set up sign-in?</h1>
          <p className="welcome-muted">With an account, each browser signs in the first time it opens Dundra after the server starts.</p>
          <div className="welcome-fields">
            <label>Account name<input name="username" required maxLength={80} autoComplete="username" value={accountName} disabled={busy}
              onChange={event => setAccountName(event.target.value)} /></label>
            <div className="welcome-password-field">
              <label>Password<input name="password" type="password" minLength={12} maxLength={256} required
                autoComplete="new-password" aria-describedby="welcome-password-help" disabled={busy} /></label>
              <small className="welcome-muted" id="welcome-password-help">At least 12 characters.</small>
            </div>
            <label>Confirm password<input name="confirm" type="password" maxLength={256} required
              autoComplete="new-password" disabled={busy} /></label>
          </div>
          {problem && <p className="error" role="alert">{problem}</p>}
        </div>
        <footer className="welcome-actions welcome-account-actions">
          <button type="button" className="quiet welcome-back" disabled={busy} onClick={() => move(1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setFormError(""); finish(); }}>Skip account</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Create account"}</button>
        </footer>
      </form>}
    </section>
  </div>;
}

function SignIn({ busy, error, submit }: AccessActions) {
  return <form className="welcome-card welcome-locked" onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({ action: "login", name: form.get("name"), password: form.get("password") });
  }}>
    <Brand />
    <div>
      <h1>Sign in to Dundra</h1>
    </div>
    <div className="welcome-fields">
      <label>Account name<input name="name" required maxLength={80} autoComplete="username" /></label>
      <label>Password<input name="password" type="password" maxLength={256} required autoComplete="current-password" /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>;
}
