from pathlib import Path

path = Path("tests/canonical-route-sync.spec.ts")
text = path.read_text()
old = '''  const removal = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  });
  expect(removal.removed).toBe(true);
  await expect.poll(async () => {
    const result = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator");
    return Boolean(result.status?.exists);
  }, { timeout: 60_000 }).toBe(false);
  const simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "create" },
  });
  expect(simulation.created).toBe(true);
'''
new = '''  let simulation: any = null;
  for (let attempt = 0; attempt < 3 && !simulation; attempt += 1) {
    const removal = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
      method: "POST",
      body: { action: "remove" },
    });
    expect(removal.removed).toBe(true);
    await expect.poll(async () => {
      const result = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator");
      return Boolean(result.status?.exists);
    }, { timeout: 60_000 }).toBe(false);
    await adminDesktop.waitForTimeout(750 * (attempt + 1));
    try {
      simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
        method: "POST",
        body: { action: "create" },
      });
    } catch (error) {
      if (attempt === 2 || !/simulation already exists/i.test(String(error))) throw error;
    }
  }
  expect(simulation?.created).toBe(true);
'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"expected one simulator setup block, found {count}")
path.write_text(text.replace(old, new, 1))
