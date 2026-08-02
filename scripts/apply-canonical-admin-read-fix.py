from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/admin/customers/route.ts",
    '''export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    const context = await listOperationalCompanyCustomers(service, companyId, { repair: true });''',
    '''export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await companyAdmin(request);
    // GET is read-only. Ownership repair belongs to explicit write/migration paths;
    // mutating several tables during every page load caused concurrent Admin reads to fail.
    const context = await listOperationalCompanyCustomers(service, companyId, { repair: false });''',
)

replace_once(
    "app/api/admin/customers/route.ts",
    '''  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customers could not be loaded." }, { status: 401 });
  }
}''',
    '''  } catch (error) {
    const message = error instanceof Error ? error.message : "Customers could not be loaded.";
    const status = /sign in|session expired|only a company admin|customer manager/i.test(message) ? 401 : 500;
    console.error("admin-customers-get", error);
    return NextResponse.json({ error: message }, { status });
  }
}''',
)

replace_once(
    "app/api/admin/routes/route.ts",
    '''  } catch (error) {
    console.error("admin-routes-get", error);
    return fail(error, 401);
  }
}''',
    '''  } catch (error) {
    const message = error instanceof Error ? error.message : "Route request failed.";
    const status = /sign in|session expired|only an active company admin/i.test(message) ? 401 : 500;
    console.error("admin-routes-get", error);
    return fail(error, status);
  }
}''',
)

print("Canonical Admin read paths are now single-source and read-only.")
