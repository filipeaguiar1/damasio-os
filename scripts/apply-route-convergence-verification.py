from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/mobile/employee/route/route.ts",
    '''export async function GET(request: NextRequest) {''',
    '''function executionTransitionConverged(action: VisitAction, visit: any) {
  if (!visit) return false;
  const status = String(visit.status || "");
  if (action === "start") {
    return status === "in_progress" && Boolean(visit.started_at) && !visit.finished_at;
  }
  if (action === "done") {
    return status === "completed"
      && Boolean(visit.started_at)
      && Boolean(visit.finished_at)
      && Number.isFinite(Number(visit.duration_seconds))
      && Number(visit.duration_seconds) >= 0;
  }
  if (action === "skip") return status === "missed";
  return status === "scheduled"
    && !visit.started_at
    && !visit.finished_at
    && visit.duration_seconds == null;
}

export async function GET(request: NextRequest) {''',
)

replace_once(
    "app/api/mobile/employee/route/route.ts",
    '''    const result = await user.rpc("transition_visit_execution", {
      p_visit_id: visitId,
      p_action: action,
      p_reason: reason || null,
    });

    if (result.error) {
      // The API has already authenticated the Employee and verified the Visit belongs
      // to this Employee/company. Apply the same invariant-checked server fallback for
      // legacy RPC permissions as well as a missing migration; never pretend the action
      // succeeded by leaving it only in a browser queue.
      console.warn("employee-route-rpc-fallback", { visitId, action, message: result.error.message });
      const visit = await fallbackVisitTransition({
        service,
        employee,
        userId,
        companyId,
        visitId,
        action,
        reason,
      });
      return NextResponse.json({ visit, fallback: true });
    }

    return NextResponse.json({ visit: result.data, fallback: false });''',
    '''    const result = await user.rpc("transition_visit_execution", {
      p_visit_id: visitId,
      p_action: action,
      p_reason: reason || null,
    });

    if (!result.error) {
      const verified = await service
        .from("visits")
        .select("id,status,scheduled_date,started_at,finished_at,duration_seconds,route_id,route_order")
        .eq("id", visitId)
        .or(companyFilter(companyId))
        .maybeSingle();
      if (verified.error) throw new Error(verified.error.message);
      if (executionTransitionConverged(action, verified.data)) {
        return NextResponse.json({ visit: verified.data, fallback: false, verified: true });
      }
      console.warn("employee-route-rpc-nonconvergent", {
        visitId,
        action,
        returned: result.data,
        storedStatus: verified.data?.status || null,
      });
    } else {
      console.warn("employee-route-rpc-fallback", { visitId, action, message: result.error.message });
    }

    // Authentication and assignment were already checked by this API. The service-side
    // transition is the compatibility path for an absent, stale or non-convergent RPC.
    // Returning success is forbidden until the stored Visit satisfies the invariant.
    const visit = await fallbackVisitTransition({
      service,
      employee,
      userId,
      companyId,
      visitId,
      action,
      reason,
    });
    if (!executionTransitionConverged(action, visit)) {
      throw new Error("The Visit transition did not converge in the canonical database.");
    }
    return NextResponse.json({ visit, fallback: true, verified: true });''',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '''          if (response.ok) break;
          if (![502, 503, 504].includes(response.status) || attempt === 2) {
            throw new Error(result.error || `Routes could not be loaded (${response.status}).`);
          }
        } catch (reason) {
          const retryable = reason instanceof Error && /fetch|network|abort|load failed/i.test(reason.message);''',
    '''          if (response.ok) break;
          const genericBadRequest = response.status === 400
            && /^bad request$/i.test(String(result?.error || ""));
          if ((!genericBadRequest && ![502, 503, 504].includes(response.status)) || attempt === 2) {
            throw new Error(result.error || `Routes could not be loaded (${response.status}).`);
          }
          await new Promise(resolve => window.setTimeout(resolve, 400 * (attempt + 1)));
        } catch (reason) {
          const retryable = reason instanceof Error && /fetch|network|abort|load failed/i.test(reason.message);''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `${response.status} ${path}`);
          return result;''',
    '''          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = result.error || `${response.status} ${path}`;
            throw new Error(`HTTP_${response.status}:${message}`);
          }
          return result;''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === 2 || !/fetch failed|failed to fetch|network|abort/i.test(lastError)) throw error;
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw new Error(lastError);''',
    '''    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /^HTTP_400:Bad Request$/i.test(lastError);
      if (attempt === 2 || !retryable) {
        throw new Error(lastError.replace(/^HTTP_\\d+:/, ""));
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw new Error(lastError.replace(/^HTTP_\\d+:/, ""));''',
)

print("Verified route convergence and transient Admin retry patch applied.")
