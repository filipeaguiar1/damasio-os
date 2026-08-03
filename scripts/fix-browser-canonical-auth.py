from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))

replace_once(
    "lib/routes/canonicalRouteSnapshot.ts",
    '''async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token as string;
}''',
    '''function storedAccessToken() {
  if (typeof window === "undefined") return null;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || "null");
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (typeof token === "string" && token.length > 20) return token;
    } catch {
      // A malformed unrelated storage value must not block the canonical route.
    }
  }
  return null;
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token || storedAccessToken();
  if (token) return token as string;
  if (error) throw new Error(error.message);

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data?.session?.access_token || storedAccessToken();
  if (!refreshedToken) throw new Error("Your session expired. Sign in again.");
  return refreshedToken as string;
}''',
)

replace_once(
    "lib/services/employeeIdentityService.ts",
    '''    const select = "id,full_name,email,crew_id,profile_id,address_line1,route_start_address,crews(id,name)";
    let { data: employee, error } = await supabase
      .from("employees")
      .select(select)
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if ((!employee || error) && user.email) {
      const byEmail = await supabase
        .from("employees")
        .select(select)
        .ilike("email", user.email.trim())
        .eq("active", true)
        .maybeSingle();
      employee = byEmail.data;
      error = byEmail.error;

      if (employee && !employee.profile_id) {
        await supabase.from("employees").update({ profile_id: user.id }).eq("id", employee.id).is("profile_id", null);
      }
    }

    if (error || !employee) return fallback;''',
    '''    const select = "id,full_name,email,crew_id,profile_id,address_line1,route_start_address,created_at,crews(id,name)";
    const byProfile = await supabase
      .from("employees")
      .select(select)
      .eq("profile_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    let error = byProfile.error;
    let employee = (byProfile.data || []).find((candidate: any) => Boolean(candidate.crew_id))
      || byProfile.data?.[0]
      || null;

    if ((!employee || error) && user.email) {
      const byEmail = await supabase
        .from("employees")
        .select(select)
        .ilike("email", user.email.trim())
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(20);
      employee = (byEmail.data || []).find((candidate: any) => Boolean(candidate.crew_id))
        || byEmail.data?.[0]
        || null;
      error = byEmail.error;

      if (employee && !employee.profile_id) {
        await supabase.from("employees").update({ profile_id: user.id }).eq("id", employee.id).is("profile_id", null);
      }
    }

    if (error || !employee) return fallback;''',
)
