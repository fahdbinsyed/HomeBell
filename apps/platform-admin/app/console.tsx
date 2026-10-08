"use client";
import { useEffect, useRef, useState } from "react";
type Policy = {
  allowed: boolean;
  reason: string;
  childCap: number;
  capabilities: string[];
  expiresAt: string | null;
  effectiveState: string;
  provenance: { id: string; kind: string; source: string }[];
};
type Entry = Record<string, unknown>;
type Tenant = {
  id: string;
  name: string;
  timeZone: string;
  version: number;
  status: string;
  entitlements: Policy;
  usage: {
    activeStudents: number;
    totalStudents: number;
    activeGuardians: number;
    blockedGuardians: number;
    activeStaff: number;
    observedAt: string;
  };
  grants?: Entry[];
  overrides?: Entry[];
  subscriptions?: Entry[];
};
type Plan = {
  id: string;
  name: string;
  code: string;
  version: number;
  archived: boolean;
  versions: {
    id: string;
    number: number;
    amountMinor: number;
    childCap: number;
    capabilities: string[];
  }[];
};
type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string | number;
  options?: { value: string; label: string }[];
};
type Action = {
  title: string;
  effect: string;
  path: string;
  fields: Field[];
  fixed?: Entry;
};
const caps = [
  "tenant.read",
  "school.records.read",
  "school.records.write",
  "guardians.read",
  "guardians.manage",
  "audit.read",
];
const stateLabels: Record<string, string> = {
  draft: "Draft",
  trial: "Trial",
  pilot_free: "Free / pilot",
  active_paid: "Annual plan",
  manual_override: "Manual access",
  suspended: "Suspended",
  deactivated: "Deactivated",
  cancelled: "Cancelled",
  offboarding: "Offboarding",
  expired: "Expired",
};
const date = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "—");
const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("hb_platform_csrf="))
      ?.split("=")
      .slice(1)
      .join("=") ?? "",
  );
let refreshing: Promise<boolean> | null = null;
async function call<T>(
  path: string,
  body?: Entry,
  key?: string,
  retry = true,
): Promise<{ data: T; meta?: { nextCursor?: string | null } }> {
  const response = await fetch(`/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf(),
          "Idempotency-Key": key ?? crypto.randomUUID(),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (
    response.status === 401 &&
    retry &&
    (path === "platform-auth/me" || !path.startsWith("platform-auth/"))
  ) {
    refreshing ??= fetch("/api/v1/platform-auth/refresh", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf() },
    })
      .then((r) => r.ok)
      .finally(() => {
        refreshing = null;
      });
    if (await refreshing) return call(path, body, key, false);
  }
  if (response.status === 204) return { data: null as T };
  if (response.status === 401 && path !== "platform-auth/me")
    window.dispatchEvent(new Event("homebell-session-expired"));
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `${result.error?.code ?? "REQUEST_FAILED"}${response.headers.get("x-request-id") ? ` · Reference ${response.headers.get("x-request-id")}` : ""}`,
    );
  return result;
}
const reason: Field = { name: "reason", label: "Reason", type: "textarea" };
const grantFields: Field[] = [
  {
    name: "startsAt",
    label: "Access starts (UTC)",
    type: "datetime-local",
    value: new Date(Date.now() - 60000).toISOString().slice(0, 16),
  },
  {
    name: "endsAt",
    label: "Access ends (UTC)",
    type: "datetime-local",
    value: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16),
  },
  { name: "childCap", label: "Licensed children", type: "number", value: 100 },
  {
    name: "capabilities",
    label: "Included capabilities",
    type: "capabilities",
  },
  reason,
];
function ActionDialog({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    attempt = useRef<{ body: string; key: string } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [termStart, setTermStart] = useState(
    String(action.fields.find((f) => f.name === "startsAt")?.value ?? ""),
  );
  const end = new Date(`${termStart}Z`);
  const month = end.getUTCMonth();
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  if (end.getUTCMonth() !== month) end.setUTCDate(0);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget),
      body: Entry = { ...action.fixed };
    for (const field of action.fields) {
      const value = String(values.get(field.name) ?? "");
      if (field.name === "refundStatus" && !value) continue;
      body[field.name] =
        field.type === "number"
          ? Number(value)
          : field.type === "datetime-local"
            ? new Date(`${value}Z`).toISOString()
            : field.type === "capabilities"
              ? values.getAll(field.name)
              : value;
      if (field.name === "value")
        body[field.name] =
          value === "true" ? true : value === "false" ? false : Number(value);
    }
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized)
      attempt.current = { body: serialized, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      await call(action.path, body, attempt.current.key);
      try {
        await onDone();
      } catch {
        /* The mutation committed; refreshing the view is independently retryable. */
      }
      onClose();
    } catch (e) {
      setError(
        `${(e as Error).message}. If the result is unknown, retry this form unchanged. For VERSION_CONFLICT, close and refresh before trying again.`,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (pending) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="action-title"
    >
      <form onSubmit={submit}>
        <div className="eyebrow">CONFIRM PLATFORM ACTION</div>
        <h2 id="action-title">{action.title}</h2>
        <p>{action.effect}</p>
        {action.fields.map((f) =>
          f.type === "capabilities" ? (
            <fieldset key={f.name}>
              <legend>{f.label}</legend>
              {caps.map((c) => (
                <label className="check" key={c}>
                  <input
                    type="checkbox"
                    name={f.name}
                    value={c}
                    defaultChecked
                  />
                  {c}
                </label>
              ))}
            </fieldset>
          ) : (
            <label key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  name={f.name}
                  aria-label={f.label}
                  defaultValue={f.value}
                  required={f.name !== "refundStatus"}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  required
                  maxLength={f.name === "text" ? 2000 : 500}
                />
              ) : (
                <input
                  name={f.name}
                  type={f.type ?? "text"}
                  defaultValue={f.value}
                  onChange={
                    f.name === "startsAt"
                      ? (e) => setTermStart(e.target.value)
                      : undefined
                  }
                  required
                  min={f.type === "number" ? 0 : undefined}
                  step={f.type === "number" ? 1 : undefined}
                  maxLength={200}
                />
              )}
            </label>
          ),
        )}
        {action.path.endsWith("/subscriptions") && !Number.isNaN(+end) && (
          <p>
            Annual term ends: <strong>{end.toISOString()}</strong>. The amount
            is recorded manually, without a payment verification claim.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button disabled={pending}>{pending ? "Saving…" : "Confirm"}</button>
        </div>
      </form>
    </dialog>
  );
}
export default function Console() {
  const [session, setSession] = useState<{ permissions: string[] } | null>(
      null,
    ),
    [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState("schools"),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [next, setNext] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<Tenant | null>(null),
    [tab, setTab] = useState("overview");
  const [plans, setPlans] = useState<Plan[]>([]),
    [entries, setEntries] = useState<Entry[]>([]),
    [action, setAction] = useState<Action | null>(null);
  const [overview, setOverview] = useState({
    total: 0,
    active: 0,
    expiring: 0,
    reconciliation: 0,
  });
  const [planCursor, setPlanCursor] = useState<string | null>(null),
    [entryMore, setEntryMore] = useState<string | null>(null);
  async function planList(cursor?: string) {
    const r = await call<Plan[]>(
      `platform/plans?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setPlans(cursor ? [...plans, ...r.data] : r.data);
    setPlanCursor(r.meta?.nextCursor ?? null);
  }
  const can = (p: string) => session?.permissions.includes(p);
  async function tenantList(cursor?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    if (cursor) q.set("cursor", cursor);
    const r = await call<Tenant[]>(`platform/tenants?${q}`);
    setTenants(cursor ? [...tenants, ...r.data] : r.data);
    setNext(r.meta?.nextCursor ?? null);
  }
  async function loadEntries(t = selected, section = tab) {
    setEntries([]);
    setEntryMore(null);
    let url = "";
    if (section === "notes" && t)
      url = `platform/tenants/${t.id}/notes?limit=100`;
    if (section === "audit") {
      const q = new URLSearchParams({
        from: new Date(Date.now() - 30 * 86400000).toISOString(),
        to: new Date().toISOString(),
        limit: "100",
      });
      if (t) q.set("tenantId", t.id);
      url = `platform/audit-events?${q}`;
    }
    if (url) await entryPage(url, false);
  }
  async function entryPage(url: string, append: boolean) {
    const r = await call<Entry[]>(url);
    setEntries(append ? [...entries, ...r.data] : r.data);
    const next = new URL(url, "https://internal.invalid/");
    if (r.meta?.nextCursor) next.searchParams.set("cursor", r.meta.nextCursor);
    setEntryMore(
      r.meta?.nextCursor ? next.pathname.slice(1) + next.search : null,
    );
  }
  async function guard(work: () => Promise<void>) {
    setLoading(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refresh() {
    await tenantList();
    setOverview((await call<typeof overview>("platform/overview")).data);
    if (can("plan.read")) await planList();
    if (selected) {
      const t = (await call<Tenant>(`platform/tenants/${selected.id}`)).data;
      setSelected(t);
      await loadEntries(t);
    }
  }
  useEffect(() => {
    let mounted = true;
    const expired = () => {
      setSession(null);
      setAction(null);
      setError("Session expired. Please sign in again.");
    };
    window.addEventListener("homebell-session-expired", expired);
    (async () => {
      try {
        const config = await call<{ configured: boolean }>(
          "platform-auth/config",
        );
        if (mounted) setConfigured(config.data.configured);
        const user = await call<{ permissions: string[] }>("platform-auth/me");
        if (mounted) {
          setSession(user.data);
          setOverview((await call<typeof overview>("platform/overview")).data);
          const schools = await call<Tenant[]>("platform/tenants");
          setTenants(schools.data);
          setNext(schools.meta?.nextCursor ?? null);
          if (user.data.permissions.includes("plan.read")) await planList();
        }
      } catch (e) {
        if (mounted && !String(e).includes("SESSION_INVALID"))
          setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      window.removeEventListener("homebell-session-expired", expired);
    };
  }, []);
  const tenantAction = (
    title: string,
    path: string,
    fields: Field[],
    fixed: Entry = {},
    effect?: string,
  ) =>
    selected &&
    setAction({
      title,
      effect:
        effect ??
        `Update ${selected.name}. This change is audited and takes effect when saved.`,
      path: `platform/tenants/${selected.id}/${path}`,
      fields,
      fixed: { expectedVersion: selected.version, ...fixed },
    });
  const actionDone = async () => {
    setNotice("Change saved.");
    await refresh();
  };
  const auditAllowed = session?.permissions.some((p) => p.startsWith("audit."));
  if (!session)
    return (
      <main className="signin">
        <div className="brand">◉ HomeBell</div>
        <div className="signin-card">
          <div className="eyebrow">PLATFORM OPERATIONS</div>
          <h1>
            A clear view of
            <br />
            every school.
          </h1>
          <p>
            Manage school access, annual plans and platform operations in one
            place.
          </p>
          {loading ? (
            <p role="status">Checking your session…</p>
          ) : configured ? (
            <a
              className="button"
              href="/api/v1/platform-auth/oidc/start?audience=platform"
            >
              Sign in with your organization →
            </a>
          ) : (
            <div className="configuration">
              <strong>Sign-in configuration required</strong>
              <p>
                Configure the platform identity provider and callback URL using
                the local setup guide. Platform access requires a provisioned
                account and MFA.
              </p>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <p className="footnote">
          HomeBell owner console · Authorized operators
        </p>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          ◉ HomeBell
        </a>
        <div className="eyebrow">OWNER CONSOLE</div>
        <nav>
          <button
            className={view === "schools" ? "active" : ""}
            onClick={() => {
              setView("schools");
              setSelected(null);
            }}
          >
            Schools <span>↗</span>
          </button>
          {can("plan.read") && (
            <button
              className={view === "plans" ? "active" : ""}
              onClick={() => {
                setView("plans");
                setSelected(null);
              }}
            >
              Plans
            </button>
          )}
          {auditAllowed && (
            <button
              className={view === "audit" ? "active" : ""}
              onClick={() => {
                setView("audit");
                setSelected(null);
                void guard(() => loadEntries(null, "audit"));
              }}
            >
              Audit log
            </button>
          )}
        </nav>
        <div className="aside-bottom">
          Platform access
          <br />
          <small>MFA protected session</small>
          <button
            className="secondary"
            onClick={() =>
              void guard(async () => {
                await call("platform-auth/logout", {});
                setSession(null);
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div className="eyebrow">
            HOMEBELL / {selected ? "SCHOOL DETAIL" : view.toUpperCase()}
          </div>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void guard(refresh)}
          >
            Refresh
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button onClick={() => void guard(refresh)}>Try again</button>
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {loading && <p role="status">Loading…</p>}
        {view === "schools" && !selected && (
          <>
            <div className="heading">
              <div>
                <h1>Schools</h1>
                <p>Access, capacity and the next decision.</p>
              </div>
              {can("tenant.create") && (
                <button
                  onClick={() =>
                    setAction({
                      title: "Create a school",
                      effect:
                        "Create a draft school with a default campus. Access begins after an explicit grant or annual plan assignment.",
                      path: "platform/tenants",
                      fields: [
                        { name: "name", label: "School name" },
                        {
                          name: "timeZone",
                          label: "IANA time zone",
                          value: "Asia/Kolkata",
                        },
                      ],
                    })
                  }
                >
                  + Create school
                </button>
              )}
            </div>
            <div className="stats">
              <article>
                <span>Total schools</span>
                <strong>{overview.total}</strong>
              </article>
              <article>
                <span>With active access</span>
                <strong>{overview.active}</strong>
              </article>
              <article>
                <span>Expiring within 30 days</span>
                <strong>{overview.expiring}</strong>
              </article>
            </div>
            <section className="panel">
              <form
                className="filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  void guard(() => tenantList());
                }}
              >
                <label>
                  Find a school
                  <input
                    placeholder="Search by school name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  Access state
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All states</option>
                    {Object.entries(stateLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary">Search</button>
              </form>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>School</th>
                      <th>Access</th>
                      <th>Licensed children</th>
                      <th>Access ends</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.name}</strong>
                          <small>{t.timeZone}</small>
                        </td>
                        <td>
                          <span
                            className={`badge ${t.entitlements.allowed ? "good" : ""}`}
                          >
                            {stateLabels[t.entitlements.effectiveState]}
                          </span>
                        </td>
                        <td>
                          {t.usage.activeStudents} / {t.entitlements.childCap}
                        </td>
                        <td>{date(t.entitlements.expiresAt)}</td>
                        <td>
                          <button
                            className="link"
                            aria-label={`Open ${t.name}`}
                            onClick={() =>
                              void guard(async () => {
                                setSelected(
                                  (
                                    await call<Tenant>(
                                      `platform/tenants/${t.id}`,
                                    )
                                  ).data,
                                );
                                setTab("overview");
                              })
                            }
                          >
                            Open →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!tenants.length && (
                <p className="empty">
                  No schools match this view. Create a school or change the
                  filters.
                </p>
              )}
              {next && (
                <button
                  className="secondary more"
                  onClick={() => void guard(() => tenantList(next))}
                >
                  Load more schools
                </button>
              )}
            </section>
          </>
        )}
        {selected && (
          <>
            <button className="link" onClick={() => setSelected(null)}>
              ← All schools
            </button>
            <div className="heading">
              <div>
                <h1>{selected.name}</h1>
                <p>
                  {selected.timeZone} · Version {selected.version}
                </p>
              </div>
              <span
                className={`badge ${selected.entitlements.allowed ? "good" : ""}`}
              >
                {stateLabels[selected.entitlements.effectiveState]}
              </span>
            </div>
            <div className="tabs">
              {[
                "overview",
                "access",
                ...(can("notes.read") ? ["notes"] : []),
                ...(auditAllowed ? ["audit"] : []),
              ].map((s) => (
                <button
                  className={tab === s ? "active" : ""}
                  key={s}
                  onClick={() => {
                    setTab(s);
                    void guard(() => loadEntries(selected, s));
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {tab === "overview" && (
              <>
                <div className="stats">
                  <article>
                    <span>Licensed children</span>
                    <strong>
                      {selected.usage.activeStudents}{" "}
                      <small>/ {selected.entitlements.childCap}</small>
                    </strong>
                  </article>
                  <article>
                    <span>Active guardians</span>
                    <strong>{selected.usage.activeGuardians}</strong>
                  </article>
                  <article>
                    <span>Active staff</span>
                    <strong>{selected.usage.activeStaff}</strong>
                  </article>
                </div>
                <section className="panel padded">
                  <h2>Current access</h2>
                  <p>
                    {selected.entitlements.allowed
                      ? "Protected school operations are available."
                      : "Protected school operations are unavailable."}
                  </p>
                  <dl>
                    <dt>Decision</dt>
                    <dd>{selected.entitlements.reason}</dd>
                    <dt>Access ends</dt>
                    <dd>{date(selected.entitlements.expiresAt)}</dd>
                    <dt>Usage observed</dt>
                    <dd>{date(selected.usage.observedAt)}</dd>
                    <dt>Blocked guardians</dt>
                    <dd>{selected.usage.blockedGuardians}</dd>
                  </dl>
                  {can("tenant.lifecycle") && (
                    <div className="actions wrap">
                      {[
                        "activate",
                        "suspend",
                        "deactivate",
                        "cancel",
                        "offboard",
                        "reinstate",
                      ].map((a) => (
                        <button
                          className="secondary"
                          key={a}
                          onClick={() =>
                            tenantAction(
                              `${a[0].toUpperCase() + a.slice(1)} school`,
                              "lifecycle-actions",
                              [reason],
                              { action: a },
                              `${a.toUpperCase()}: ${selected.name}. Suspension, cancellation, deactivation and offboarding immediately deny school operations. Reinstate requires a current valid grant. Offboarding does not delete data.`,
                            )
                          }
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
            {tab === "access" && (
              <>
                <section className="panel padded">
                  <h2>Grants and annual plans</h2>
                  {selected.subscriptions?.map((s) => (
                    <article className="record" key={String(s.id)}>
                      <strong>
                        {String(s.name)} v{String(s.number)} · USD{" "}
                        {(Number(s.amountMinor) / 100).toFixed(2)} / year
                      </strong>
                      <p>
                        {date(s.startsAt)} → {date(s.endsAt)}
                      </p>
                      <small>
                        Manual reference: {String(s.manualReference)}
                      </small>
                    </article>
                  ))}
                  <p>
                    Annual assignments are recorded manually and replace current
                    non-paid access. No payment or refund is processed here.
                  </p>
                  {can("access.manage") && (
                    <div className="actions wrap">
                      {[
                        ["start_trial", "Start trial"],
                        ["grant_free", "Grant free access"],
                        ["grant_manual", "Grant manual access"],
                      ].map(([a, l]) => (
                        <button
                          className="secondary"
                          key={a}
                          onClick={() =>
                            tenantAction(l, "lifecycle-actions", grantFields, {
                              action: a,
                            })
                          }
                        >
                          {l}
                        </button>
                      ))}
                      <button
                        disabled={
                          !plans.some((p) => !p.archived && p.versions.length)
                        }
                        onClick={() =>
                          tenantAction("Assign annual plan", "subscriptions", [
                            {
                              name: "planVersionId",
                              label: "Immutable annual plan version",
                              options: plans
                                .filter((p) => !p.archived)
                                .flatMap((p) =>
                                  p.versions.map((v) => ({
                                    value: v.id,
                                    label: `${p.name} v${v.number} · USD ${(v.amountMinor / 100).toFixed(2)} / year · ${v.childCap} children`,
                                  })),
                                ),
                            },
                            {
                              name: "startsAt",
                              label: "Annual term starts (UTC)",
                              type: "datetime-local",
                              value: new Date(Date.now() - 60000)
                                .toISOString()
                                .slice(0, 16),
                            },
                            {
                              name: "manualReference",
                              label: "Manual commercial reference",
                            },
                            reason,
                          ])
                        }
                      >
                        Assign annual plan
                      </button>
                    </div>
                  )}
                  {selected.grants?.map((g) => (
                    <article className="record" key={String(g.id)}>
                      <strong>
                        {String(g.kind)} · {String(g.childCap)} children
                      </strong>
                      <p>
                        {date(g.startsAt)} → {date(g.endsAt)}
                      </p>
                      <small>Source: {String(g.provenance)}</small>
                      {can("access.manage") && (
                        <button
                          className="link"
                          onClick={() =>
                            tenantAction(
                              "Extend access",
                              "access-extensions",
                              [
                                {
                                  name: "endsAt",
                                  label: "New access end (UTC)",
                                  type: "datetime-local",
                                },
                                reason,
                              ],
                              { grantId: g.id },
                            )
                          }
                        >
                          Extend access
                        </button>
                      )}
                    </article>
                  ))}
                  {!selected.grants?.length && (
                    <p className="empty">No access grant has been assigned.</p>
                  )}
                </section>
                <section className="panel padded">
                  <h2>Effective capabilities</h2>
                  <p>
                    {selected.entitlements.capabilities.join(" · ") ||
                      "No capabilities available"}
                  </p>
                  <h2>Bounded overrides</h2>
                  {can("access.manage") && (
                    <button
                      className="secondary"
                      onClick={() =>
                        tenantAction(
                          "Add entitlement override",
                          "entitlement-overrides",
                          [
                            {
                              name: "target",
                              label: "Target",
                              options: ["childCap", ...caps].map((v) => ({
                                value: v,
                                label: v,
                              })),
                            },
                            {
                              name: "value",
                              label: "Value: child count or true / false",
                            },
                            ...grantFields.filter((f) =>
                              ["startsAt", "endsAt", "reason"].includes(f.name),
                            ),
                          ],
                        )
                      }
                    >
                      Add override
                    </button>
                  )}
                  {selected.overrides?.map((o) => (
                    <article className="record" key={String(o.id)}>
                      <strong>
                        {String(o.target)}: {String(o.intValue ?? o.boolValue)}
                      </strong>
                      <p>
                        {date(o.startsAt)} → {date(o.endsAt)}{" "}
                        {o.revokedAt ? " · Revoked" : ""}
                      </p>
                      {!o.revokedAt && can("access.manage") && (
                        <button
                          className="link"
                          onClick={() =>
                            tenantAction(
                              "Revoke override",
                              `entitlement-overrides/${o.id}/revoke`,
                              [reason],
                            )
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              </>
            )}
            {tab === "notes" && (
              <section className="panel padded">
                <div className="heading">
                  <h2>Internal notes</h2>
                  {can("notes.write") && (
                    <button
                      onClick={() =>
                        tenantAction("Add internal note", "notes", [
                          {
                            name: "text",
                            label: "Internal note",
                            type: "textarea",
                          },
                          {
                            name: "refundStatus",
                            label: "Manual refund status (optional)",
                            options: [
                              { value: "", label: "No refund status" },
                              ...[
                                "requested",
                                "reviewing",
                                "manually_recorded",
                                "declined",
                              ].map((value) => ({ value, label: value })),
                            ],
                          },
                          reason,
                        ])
                      }
                    >
                      Add note
                    </button>
                  )}
                </div>
                <p>
                  Visible to authorized platform operators. Never shared with
                  school users.
                </p>
                {entries.map((n) => (
                  <article className="record" key={String(n.id)}>
                    <p>{String(n.body)}</p>
                    <small>
                      {date(n.createdAt)}{" "}
                      {n.refundStatus
                        ? ` · Refund status: ${n.refundStatus}`
                        : ""}
                    </small>
                  </article>
                ))}
                {!entries.length && <p className="empty">No notes yet.</p>}
              </section>
            )}
            {tab === "audit" && <Audit entries={entries} />}
          </>
        )}
        {view === "plans" && (
          <>
            <div className="heading">
              <div>
                <h1>Annual plans</h1>
                <p>USD pricing, immutable versions, explicit capacity.</p>
              </div>
              {can("plan.manage") && (
                <button
                  onClick={() =>
                    setAction({
                      title: "Create plan",
                      effect:
                        "Create a plan definition. Publish a priced version before assigning it.",
                      path: "platform/plans",
                      fields: [
                        { name: "name", label: "Plan name" },
                        { name: "code", label: "Unique plan code" },
                        reason,
                      ],
                    })
                  }
                >
                  + Create plan
                </button>
              )}
            </div>
            {plans.map((p) => (
              <section className="panel padded" key={p.id}>
                <div className="heading">
                  <div>
                    <h2>{p.name}</h2>
                    <small>
                      {p.code} · {p.archived ? "Archived" : "Available"}
                    </small>
                  </div>
                  {can("plan.manage") && !p.archived && (
                    <div className="actions">
                      <button
                        className="secondary"
                        onClick={() =>
                          setAction({
                            title: "Publish plan version",
                            effect: `Publish a new immutable version of ${p.name}. Existing assignments keep their previous terms.`,
                            path: `platform/plans/${p.id}/versions`,
                            fixed: { expectedVersion: p.version },
                            fields: [
                              {
                                name: "amountMinor",
                                label: "Annual USD amount in cents",
                                type: "number",
                              },
                              {
                                name: "childCap",
                                label: "Licensed children",
                                type: "number",
                              },
                              {
                                name: "capabilities",
                                label: "Included capabilities",
                                type: "capabilities",
                              },
                              reason,
                            ],
                          })
                        }
                      >
                        Publish version
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          setAction({
                            title: "Archive plan",
                            effect: `Stop new assignments of ${p.name}. Existing annual terms remain unchanged.`,
                            path: `platform/plans/${p.id}/archive`,
                            fixed: { expectedVersion: p.version },
                            fields: [reason],
                          })
                        }
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </div>
                {p.versions.map((v) => (
                  <div className="record" key={v.id}>
                    <strong>
                      Version {v.number} · USD{" "}
                      {(v.amountMinor / 100).toFixed(2)} / year
                    </strong>
                    <p>{v.childCap} licensed children</p>
                  </div>
                ))}
                {!p.versions.length && <p>No published versions.</p>}
              </section>
            ))}
            {planCursor && (
              <button
                className="secondary"
                onClick={() => void guard(() => planList(planCursor))}
              >
                Load more plans
              </button>
            )}
            {!plans.length && (
              <p className="empty">
                Create your first plan. No default prices have been seeded.
              </p>
            )}
          </>
        )}
        {view === "audit" && (
          <>
            <h1>Platform audit</h1>
            <p>
              Last 30 days, limited to your authorized action categories. Up to
              100 events.
            </p>
            <Audit entries={entries} />
          </>
        )}
        {entryMore &&
          (view === "audit" ||
            (selected && (tab === "audit" || tab === "notes"))) && (
            <button
              className="secondary"
              onClick={() => void guard(() => entryPage(entryMore, true))}
            >
              Load more events
            </button>
          )}
        <footer>
          HomeBell · Platform operations{" "}
          <span>Access decisions are enforced by the server.</span>
        </footer>
      </main>
      {action && (
        <ActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={actionDone}
        />
      )}
    </div>
  );
}
function Audit({ entries }: { entries: Entry[] }) {
  return (
    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>When</th>
              <th>Actor</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={String(e.id)}>
                <td>{String(e.action)}</td>
                <td>{date(e.createdAt)}</td>
                <td>{String(e.operatorName ?? e.actorId ?? "System")}</td>
                <td>{String(e.category)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!entries.length && (
        <p className="empty">No events in this authorized view.</p>
      )}
    </section>
  );
}
