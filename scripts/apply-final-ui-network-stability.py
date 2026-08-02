from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/employee/route/page.tsx",
    '''  const session=selected?getSessionForLead(selected.id):null;
  const openTasks=tasks.filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew));''',
    '''  const session=selected?getSessionForLead(selected.id):null;
  const canonicalActive=Boolean(selected?.canonicalVisitId)&&(
    selected?.canonicalVisitStatus==="in_progress"
    || selected?.canonicalVisitStatus==="active"
    || Boolean(selected?.visitStartedAt&&!selected?.visitFinishedAt)
  );
  const canonicalDone=Boolean(selected?.canonicalVisitId)&&(
    selected?.canonicalVisitStatus==="completed"
    || Boolean(selected?.visitFinishedAt)
  );
  const canonicalMissed=Boolean(selected?.canonicalVisitId)&&selected?.canonicalVisitStatus==="missed";
  const openTasks=tasks.filter(t=>(t.status==="assigned"||t.status==="in_progress")&&(t.assignedTo===profile.name||t.assignedTo===crew));''',
)

replace_once(
    "app/employee/route/page.tsx",
    '''        <div className={(selected.canonicalVisitStatus==="in_progress"||session?.status==="running")?"timer-status running":(selected.canonicalVisitStatus==="completed"||session?.status==="finished")?"timer-status finished":"timer-status"}>{selected.canonicalVisitStatus==="in_progress"||session?.status==="running"?"IN PROGRESS":selected.canonicalVisitStatus==="completed"||session?.status==="finished"?"DONE":selected.canonicalVisitStatus==="missed"?"SKIPPED":"NOT STARTED"}</div>''',
    '''        <div className={(canonicalActive||session?.status==="running")?"timer-status running":(canonicalDone||session?.status==="finished")?"timer-status finished":"timer-status"}>{canonicalActive||session?.status==="running"?"IN PROGRESS":canonicalDone||session?.status==="finished"?"DONE":canonicalMissed?"SKIPPED":"NOT STARTED"}</div>''',
)

replace_once(
    "app/employee/route/page.tsx",
    '''        <button className="start-btn" onClick={start} disabled={selected.canonicalVisitId?selected.canonicalVisitStatus==="in_progress"||selected.canonicalVisitStatus==="completed"||selected.canonicalVisitStatus==="missed":session?.status==="running"}>Start</button>
        <button className="btn btn-outline" onClick={()=>setCommentOpen(!commentOpen)}>💬 Comment</button>
        <button className="finish-btn" onClick={finish} disabled={selected.canonicalVisitId?selected.canonicalVisitStatus!=="in_progress":!session||session.status==="finished"}>Finish</button>''',
    '''        <button className="start-btn" onClick={start} disabled={selected.canonicalVisitId?canonicalActive||canonicalDone||canonicalMissed:session?.status==="running"}>Start</button>
        <button className="btn btn-outline" onClick={()=>setCommentOpen(!commentOpen)}>💬 Comment</button>
        <button className="finish-btn" onClick={finish} disabled={selected.canonicalVisitId?!canonicalActive:!session||session.status==="finished"}>Finish</button>''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''async function authRequest<T>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return page.evaluate(async ({ path, init }) => {
    const authKey = Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
    if (!authKey) throw new Error("Supabase browser session was not found.");
    const stored = JSON.parse(window.localStorage.getItem(authKey) || "null");
    const accessToken = stored?.access_token || stored?.currentSession?.access_token;
    if (!accessToken) throw new Error("Supabase access token was not found.");
    const response = await fetch(path, {
      method: init?.method || "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `${response.status} ${path}`);
    return result;
  }, { path, init }) as Promise<T>;
}''',
    '''async function authRequest<T>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let lastError = "Request failed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(async ({ path, init }) => {
        const authKey = Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
        if (!authKey) throw new Error("Supabase browser session was not found.");
        const stored = JSON.parse(window.localStorage.getItem(authKey) || "null");
        const accessToken = stored?.access_token || stored?.currentSession?.access_token;
        if (!accessToken) throw new Error("Supabase access token was not found.");
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch(path, {
            method: init?.method || "GET",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            signal: controller.signal,
            body: init?.body === undefined ? undefined : JSON.stringify(init.body),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `${response.status} ${path}`);
          return result;
        } finally {
          window.clearTimeout(timeout);
        }
      }, { path, init }) as T;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === 2 || !/fetch failed|failed to fetch|network|abort/i.test(lastError)) throw error;
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw new Error(lastError);
}''',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''      const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Official Route Plan could not be loaded.");''',
    '''      let response: Response | null = null;
      let data: any = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 20_000);
          try {
            response = await fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, {
              headers: { authorization: `Bearer ${accessToken}` },
              cache: "no-store",
              signal: controller.signal,
            });
            data = await response.json().catch(() => ({}));
          } finally {
            window.clearTimeout(timeout);
          }
          if (response.ok) break;
          if (![502, 503, 504].includes(response.status) || attempt === 1) {
            throw new Error(data.error || `Official Route Plan failed (${response.status}).`);
          }
        } catch (reason) {
          if (attempt === 1 || !(reason instanceof Error) || !/fetch|network|abort|load failed/i.test(reason.message)) throw reason;
          await new Promise(resolve => window.setTimeout(resolve, 350));
        }
      }
      if (!response?.ok) throw new Error(data?.error || "Official Route Plan could not reach the server. Refresh and try again.");''',
)

print("Final UI/network stability patch applied.")
