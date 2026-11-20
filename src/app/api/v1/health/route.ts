export async function GET() {
  return Response.json({
    ok: true,
    service: "rareminds-eventconnect",
    status: "healthy",
    timestamp: new Date().toISOString(),
    config: {
      supabase: "Pending Configuration",
      google_drive: "Pending Configuration",
      zoho_crm: "Pending Configuration",
    },
  });
}
