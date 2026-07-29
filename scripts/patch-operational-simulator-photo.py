from pathlib import Path

route_path = Path("app/api/admin/operational-simulator/route.ts")
text = route_path.read_text()
changed = False

replacements = [
    (
        '      official_photo_url: "/demo/simulation-lawn-after.svg",',
        '      official_photo_url: null,',
    ),
    (
        '''          photos.push({
            id: randomUUID(),
            organization_id: companyId,
            company_id: companyId,
            property_id: chain.propertyId,
            visit_id: visitId,
            uploaded_by: worker.profileId,
            storage_path: `operational-simulation/${visitId}/after.svg`,
            public_url: "/demo/simulation-lawn-after.svg",
            photo_type: "after",
          });''',
        '''          photos.push({
            id: randomUUID(),
            organization_id: companyId,
            company_id: companyId,
            property_id: chain.propertyId,
            visit_id: visitId,
            uploaded_by: worker.profileId,
            storage_bucket: "work-photos",
            storage_path: `${companyId}/operational-simulation/after.svg`,
            public_url: null,
            photo_type: "after",
            caption: `${SIM_MARKER} Employee after-service evidence.`,
            sort_order: 1,
            is_profile: false,
          });''',
    ),
    (
        '''      await insertRowsWithFallback(service, "visits", operations.visits, ["company_id", "employee_notes", "customer_visible_summary"]);
      await insertRowsWithFallback(service, "photos", operations.photos, ["company_id"]);''',
        '''      await insertRowsWithFallback(service, "visits", operations.visits, ["company_id", "employee_notes", "customer_visible_summary"]);
      const photoStoragePath = `${companyId}/operational-simulation/after.svg`;
      const photoAsset = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#dce9f5"/><rect y="470" width="1200" height="330" fill="#4d8f4b"/><rect x="180" y="260" width="430" height="260" fill="#f4efe4"/><polygon points="140,280 395,90 650,280" fill="#744d3b"/><text x="60" y="735" font-family="Arial" font-size="42" fill="#ffffff">4Ever Seasons · Employee After-Service Photo · Simulation</text></svg>`;
      const uploadedPhoto = await service.storage.from("work-photos").upload(photoStoragePath, photoAsset, {
        contentType: "image/svg+xml",
        upsert: true,
      });
      if (uploadedPhoto.error) throw new Error(`work-photos: ${uploadedPhoto.error.message}`);
      await insertRowsWithFallback(service, "photos", operations.photos, ["company_id"]);''',
    ),
    (
        '''  await service.from("activity_log").delete().eq("company_id", companyId).ilike("details", `%${SIM_MARKER}%`);

  let accountsRemoved = 0;''',
        '''  await service.from("activity_log").delete().eq("company_id", companyId).ilike("details", `%${SIM_MARKER}%`);
  await service.storage.from("work-photos").remove([`${companyId}/operational-simulation/after.svg`]);

  let accountsRemoved = 0;''',
    ),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
        changed = True

if changed:
    route_path.write_text(text)

print("changed" if changed else "already-fixed")
