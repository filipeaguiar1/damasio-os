from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


for path, marker in [
    ("tests/operational-simulator.spec.ts", '''  await admin.waitForURL("**/admin", { timeout: 30_000 });'''),
    ("tests/operational-simulator.spec.ts", '''  await employee.waitForURL("**/employee", { timeout: 30_000 });'''),
    ("tests/operational-simulator.spec.ts", '''  await customerMobile.waitForURL("**/customer", { timeout: 30_000 });'''),
    ("tests/operational-simulator.spec.ts", '''  await customerDesktop.waitForURL("**/customer", { timeout: 30_000 });'''),
]:
    variable = {
        '  await admin.waitForURL("**/admin", { timeout: 30_000 });': "adminErrors",
        '  await employee.waitForURL("**/employee", { timeout: 30_000 });': "employeeErrors",
        '  await customerMobile.waitForURL("**/customer", { timeout: 30_000 });': "customerMobileErrors",
        '  await customerDesktop.waitForURL("**/customer", { timeout: 30_000 });': "customerDesktopErrors",
    }[marker]
    replace_once(path, marker, marker + f"\n  {variable}.splice(0); // Ignore requests started by the unauthenticated login page.")

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /^HTTP_(400|401):Bad Request$/i.test(lastError);
      if (attempt === 2 || !retryable) {
        throw new Error(lastError.replace(/^HTTP_\\d+:/, ""));
      }''',
    '''      const retryable = /fetch failed|failed to fetch|network|abort/i.test(lastError)
        || /HTTP_(400|401):Bad Request/i.test(lastError);
      if (attempt === 2 || !retryable) {
        throw new Error(lastError.replace(/^.*HTTP_\\d+:/, ""));
      }''',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  throw new Error(lastError.replace(/^HTTP_\\d+:/, ""));''',
    '''  throw new Error(lastError.replace(/^.*HTTP_\\d+:/, ""));''',
)

print("Authenticated E2E race handling fixed.")
