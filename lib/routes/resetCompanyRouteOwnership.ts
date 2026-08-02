import "server-only";

type ResetOptions = {
  cleanupDemoIdentities?: boolean;
};

export async function resetCompanyRouteOwnership(
  authenticatedClient: any,
  companyId: string,
  options: ResetOptions = {},
) {
  const { data, error } = await authenticatedClient.rpc(
    "reset_company_route_ownership_v2",
    {
      p_cleanup_demo_identities: options.cleanupDemoIdentities !== false,
    },
  );

  if (error) {
    if (/reset_company_route_ownership_v2|schema cache|could not find the function/i.test(error.message || "")) {
      throw new Error("The Canonical Route Stops V2 reset migration is not installed.");
    }
    throw new Error(error.message);
  }

  if (!data || String(data.companyId || "") !== companyId) {
    throw new Error("The database did not confirm the company route reset.");
  }
  if (data.canonicalSource !== "route_stops_v2") {
    throw new Error("The route reset did not use the canonical Route Stops transaction.");
  }

  return data;
}
