// ── SLO Configuration ─────────────────────────────────────────────────────────
// SLA values sourced from performance test spreadsheets.
// step matches na_keptn; request matches request field in bizevents.
// Matching is case-insensitive.

export interface SloEntry {
  project?: string;  // optional — blank means applies to all projects
  step: string;
  request: string;
  sloMs: number;
}

export interface SloConfig {
  version: 1;
  entries: SloEntry[];
}

// ── na_keptn normalization ────────────────────────────────────────────────────
// na_keptn in bizevents is wrapped: "Actions.01_GetAccessToken." or
// "Actions.GroupName.StepName." — strip the prefix and trailing dot so SLO
// step names can be stored without the wrapper (e.g. "01_GetAccessToken").

export function normalizeNaKeptn(na_keptn: string | null | undefined): string {
  let s = na_keptn ?? "";
  if (s.startsWith("Actions.")) s = s.slice("Actions.".length);
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

// ── test_execution parsing ────────────────────────────────────────────────────
// test_execution format: "{Project}-{RunType}-{UUID}"
//   e.g. "BillPay_RetailRESTSvcs-PaceBenchmark-3ec62edb-..."
//        "IBS_MOD_Home_Page-Check-B840_HP_Interopts-1a9f6e34-..."

const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_MARKERS = ["-PaceBenchmark", "-Primer", "-Check"] as const;

export function parseProjectFromTestExecution(testExecution: string): string {
  if (!testExecution) return testExecution;
  const s = testExecution.replace(UUID_SUFFIX_RE, "");
  for (const marker of RUN_MARKERS) {
    const idx = s.indexOf(marker);
    if (idx !== -1) return s.slice(0, idx);
  }
  return s;
}

export function parseScenarioFromTestExecution(testExecution: string): string {
  if (!testExecution) return testExecution;
  const s = testExecution.replace(UUID_SUFFIX_RE, "");
  const checkIdx = s.indexOf("-Check-");
  if (checkIdx !== -1) return s.slice(checkIdx + "-Check-".length);
  for (const marker of ["-PaceBenchmark", "-Primer"] as const) {
    if (s.includes(marker)) return marker.slice(1);
  }
  return s;
}

// ── Lookup helper ─────────────────────────────────────────────────────────────

export function lookupSlo(entries: SloEntry[], na_keptn: string, request: string, project?: string): number | null {
  const sl = normalizeNaKeptn(na_keptn).toLowerCase();
  const rl = request.toLowerCase();
  const pl = project?.trim().toLowerCase() ?? "";

  // Project-specific match takes priority
  if (pl) {
    for (const e of entries) {
      if (e.step.toLowerCase() === sl && e.request.toLowerCase() === rl && e.project?.trim().toLowerCase() === pl) {
        return e.sloMs;
      }
    }
  }

  // Fall back to project-agnostic entries (no project set)
  for (const e of entries) {
    if (e.step.toLowerCase() === sl && e.request.toLowerCase() === rl && !e.project?.trim()) {
      return e.sloMs;
    }
  }

  return null;
}

// ── CSV import/export ─────────────────────────────────────────────────────────

export function parseSlosCsv(text: string): SloEntry[] {
  const entries: SloEntry[] = [];
  const lines = text.split(/\r?\n/);
  let hasProjectCol = false;
  let headerSeen = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',');
    const f0 = parts[0].trim().toLowerCase();

    if (!headerSeen && (f0 === 'project' || f0 === 'step' || f0 === 'slo_ms' || f0 === 'slo_sec' || f0 === 'sla')) {
      headerSeen = true;
      hasProjectCol = f0 === 'project';
      continue;
    }

    if (hasProjectCol) {
      if (parts.length < 4) continue;
      const project = parts[0].trim();
      const step = parts[1].trim();
      const request = parts[2].trim();
      const num = parseFloat(parts[3]);
      if (!step || !request || isNaN(num) || num <= 0) continue;
      const sloMs = num <= 120 ? Math.round(num * 1000) : Math.round(num);
      entries.push({ project: project || undefined, step, request, sloMs });
    } else {
      if (parts.length < 3) continue;
      const step = parts[0].trim();
      const request = parts[1].trim();
      const raw3 = parts[2].trim().toLowerCase();
      if (raw3 === 'slo_ms' || raw3 === 'slo_sec' || raw3 === 'sla') continue;
      const num = parseFloat(parts[2]);
      if (!step || !request || isNaN(num) || num <= 0) continue;
      const sloMs = num <= 120 ? Math.round(num * 1000) : Math.round(num);
      entries.push({ step, request, sloMs });
    }
  }
  return entries;
}

export function exportSlosCsv(entries: SloEntry[]): string {
  const hasProject = entries.some(e => e.project?.trim());
  if (hasProject) {
    const lines = ['project,step,request,slo_ms'];
    for (const e of entries) lines.push(`${e.project ?? ''},${e.step},${e.request},${e.sloMs}`);
    return lines.join('\n');
  }
  const lines = ['step,request,slo_ms'];
  for (const e of entries) lines.push(`${e.step},${e.request},${e.sloMs}`);
  return lines.join('\n');
}

// ── Default SLO entries ───────────────────────────────────────────────────────
// Sourced from:
//   RDP_SLA_OTHER              — Remote Suite Test, CSPIL/OFX
//   RDP_SLA_FUSION_AND_REST    — REST Services v4 (Ext/Int), SB variants, Fusion UI
//   RDP_SLA_SOAP_SERVICES      — BPM Retail, BDE, External Transfers, PeoplePay, Zelle
//   RDP_SLA_UI_PROJECTS        — PeoplePay UI, PM2, Transfers, CST suites

export const DEFAULT_SLO_ENTRIES: SloEntry[] = [

  // ── Remote Suite Test ───────────────────────────────────────────────────────
  { step: "Add_Paymethod_Flow",  request: "AddPaymethod",    sloMs: 1250 },
  { step: "Add_Paymethod_Flow",  request: "DeletePayMethod", sloMs: 1000 },
  { step: "Get_Pend_Paymts",     request: "GetPendPymts",    sloMs: 1000 },
  { step: "Insert_Member_Flow",  request: "AddMember",       sloMs: 1250 },
  { step: "Insert_Member_Flow",  request: "DeleteMember",    sloMs:  500 },
  { step: "Login_Logout",        request: "Login",           sloMs: 1000 },
  { step: "Login_Logout",        request: "Redirect",        sloMs: 1000 },
  { step: "Login_Logout",        request: "Inbox",           sloMs: 1250 },
  { step: "Login_Logout",        request: "Logout",          sloMs:  500 },
  { step: "Upd_Mem_Dtls",        request: "UpdMemberDtls",   sloMs: 1250 },
  { step: "View_Payments",       request: "ViewPmnts",       sloMs: 1000 },

  // ── CSPIL/OFX ───────────────────────────────────────────────────────────────
  { step: "CSPIL/OFX", request: "PAYEERQ",      sloMs: 1250 },
  { step: "CSPIL/OFX", request: "PAYEEDELRQ",   sloMs:  750 },
  { step: "CSPIL/OFX", request: "PMTRQ",        sloMs: 1250 },
  { step: "CSPIL/OFX", request: "PMTCANCRQ",    sloMs:  750 },
  { step: "CSPIL/OFX", request: "PAYEESYNCRQ",  sloMs: 1000 },
  { step: "CSPIL/OFX", request: "PMTSYNCRQ",    sloMs: 1000 },
  { step: "CSPIL/OFX", request: "RECPMTSYNCRQ", sloMs: 1250 },
  { step: "CSPIL/OFX", request: "RECPMTTRNRQ",  sloMs: 1500 },

  // ── REST Services External v4 ───────────────────────────────────────────────
  { step: "AddFundProFlow_v4",          request: "01_GetAccessToken",             sloMs:  900 },
  { step: "AddFundProFlow_v4",          request: "02_AddFundAcct",                sloMs:  950 },
  { step: "AddFundProFlow_v4",          request: "03_UpdFundAcct",                sloMs:  550 },
  { step: "AddFundProFlow_v4",          request: "04_DelFundAcct",                sloMs:  650 },
  { step: "ConsumerFlow_v4",            request: "01_GetAccessToken",             sloMs:  900 },
  { step: "ConsumerFlow_v4",            request: "02_AddConsumer",                sloMs:  950 },
  { step: "ConsumerFlow_v4",            request: "03_GetConsDtl_Single_v4",       sloMs:  550 },
  { step: "ConsumerFlow_v4",            request: "04_DelConsumer_v4",             sloMs:  650 },
  { step: "FileBill_v4",                request: "01_GetAccessToken",             sloMs:  900 },
  { step: "FileBill_v4",                request: "02_FileBill",                   sloMs:  550 },
  { step: "GetAlertServices_v4",        request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetAlertServices_v4",        request: "02_GetAlertPreference",         sloMs:  450 },
  { step: "GetAlertServices_v4",        request: "03_GetAlertPreference_AllAlerts", sloMs: 500 },
  { step: "GetAlertServices_v4",        request: "04_GetAlertPreference_SingleAlert", sloMs: 450 },
  { step: "GetBillDtl_v4",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetBillDtl_v4",             request: "02_GetBillDtl",                 sloMs:  450 },
  { step: "GetConsDtl_v4",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetConsDtl_v4",             request: "02_GetConsDtl",                 sloMs:  450 },
  { step: "GetFiDetails_v4",           request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetFiDetails_v4",           request: "02_GetFiDtl",                   sloMs:  350 },
  { step: "GetFundPro_v4",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetFundPro_v4",             request: "02_GetFundPro",                 sloMs:  450 },
  { step: "GetMerchDtl_v4",            request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetMerchDtl_v4",            request: "02_GetMerchDtl",                sloMs: 1200 },
  { step: "GetPayeeDtl_All_v4",        request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPayeeDtl_All_v4",        request: "02_GetPayeeDtl_All",            sloMs:  550 },
  { step: "GetPayeeDtl_All_v4",        request: "03_GetPayeeDtl_PNN_Filter",     sloMs:  450 },
  { step: "GetPayeeDtl_Single_v4",     request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPayeeDtl_Single_v4",     request: "02_GetPayeeDtl_Single",         sloMs:  450 },
  { step: "GetPayeeDtl_Single_v4",     request: "03_GetPayeeDtl_Pagination",     sloMs:  450 },
  { step: "GetPymtDtl_All_v4",         request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPymtDtl_All_v4",         request: "02_GetPymtDtl_All",             sloMs:  450 },
  { step: "GetPymtDtl_Single_v4",      request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPymtDtl_Single_v4",      request: "02_GetPymtDtl_Single",          sloMs:  450 },
  { step: "GetRecAutoPayServices_v4",  request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetRecAutoPayServices_v4",  request: "02_GetRecAutoRule_All",          sloMs:  450 },
  { step: "GetRecAutoPayServices_v4",  request: "03_GetRecAutoRule_Single",       sloMs:  450 },
  { step: "PayeeFlow_ManAdd_v4",       request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManAdd_v4",       request: "02_AddPayee_ManAdd",            sloMs: 1250 },
  { step: "PayeeFlow_ManAdd_v4",       request: "03_UpdPayee_ManAdd",            sloMs: 1250 },
  { step: "PayeeFlow_ManAdd_v4",       request: "04_DelPayee_ManAdd",            sloMs:  550 },
  { step: "PayeeFlow_ManGlobal_v4",    request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManGlobal_v4",    request: "02_AddPayee_ManGlb",            sloMs: 1250 },
  { step: "PayeeFlow_ManGlobal_v4",    request: "03_UpdPayee_ManGlb",            sloMs: 1250 },
  { step: "PayeeFlow_ManGlobal_v4",    request: "04_DelPayee_ManGlb",            sloMs:  550 },
  { step: "PayeeFlow_ManRegional_v4",  request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManRegional_v4",  request: "02_AddPayee_ManReg",            sloMs: 1250 },
  { step: "PayeeFlow_ManRegional_v4",  request: "03_UpdPayee_ManReg",            sloMs: 1250 },
  { step: "PayeeFlow_ManRegional_v4",  request: "04_DelPayee_ManReg",            sloMs:  550 },
  { step: "PayeeFlow_PerCheck_v4",     request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_PerCheck_v4",     request: "02_AddPayee_Chk",               sloMs: 1250 },
  { step: "PayeeFlow_PerCheck_v4",     request: "03_UpdPayee_Chk",               sloMs:  750 },
  { step: "PayeeFlow_PerCheck_v4",     request: "04_DelPayee_Chk",               sloMs:  450 },
  { step: "PaymentFlow_Check_v4",      request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PaymentFlow_Check_v4",      request: "02_AddPmnt_Chk",                sloMs:  750 },
  { step: "PaymentFlow_Check_v4",      request: "03_UpdPmnt_Chk",                sloMs:  750 },
  { step: "PaymentFlow_Check_v4",      request: "04_DelPmnt_Chk",                sloMs:  450 },
  { step: "PaymentFlow_Electronic_v4", request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PaymentFlow_Electronic_v4", request: "02_AddPmnt_Elc",                sloMs:  750 },
  { step: "PaymentFlow_Electronic_v4", request: "03_UpdPmnt_Elc",                sloMs:  750 },
  { step: "PaymentFlow_Electronic_v4", request: "04_DelPmnt_Elc",                sloMs:  450 },
  { step: "RecAutoPayServices_v4",     request: "01_GetAccessToken",             sloMs:  900 },
  { step: "RecAutoPayServices_v4",     request: "02_AddRecAutoRule",             sloMs: 1000 },
  { step: "RecAutoPayServices_v4",     request: "03_UpdRecAutoRule",             sloMs: 1000 },
  { step: "RecAutoPayServices_v4",     request: "04_DelRecAutoRule",             sloMs:  450 },
  { step: "SSO_Flow_v4",               request: "01_GetAccessToken",             sloMs:  900 },
  { step: "SSO_Flow_v4",               request: "02_SSO_Logon",                  sloMs:  450 },
  { step: "SSO_Flow_v4",               request: "03_SSO_Audit",                  sloMs:  450 },
  { step: "UpdAlertServices_v4",       request: "01_GetAccessToken",             sloMs:  900 },
  { step: "UpdAlertServices_v4",       request: "02_UpdAlertPreference",         sloMs:  450 },
  { step: "UpdAlertServices_v4",       request: "03_UpdAlertPreference_Alert",   sloMs:  550 },
  { step: "UpdConsDtl_v4",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "UpdConsDtl_v4",             request: "02_UpdConsDtl",                 sloMs:  950 },

  // ── REST Services Internal v4 ───────────────────────────────────────────────
  // Key prefix "I:" distinguishes internal from external where step names overlap
  { step: "AddFundProFlow_v4_Int",     request: "01_GetAccessToken",             sloMs:  200 },
  { step: "AddFundProFlow_v4_Int",     request: "02_AddFundAcct",                sloMs:  700 },
  { step: "AddFundProFlow_v4_Int",     request: "03_UpdFundAcct",                sloMs:  300 },
  { step: "AddFundProFlow_v4_Int",     request: "04_DelFundAcct",                sloMs:  400 },
  { step: "ConsumerFlow_v4_Int",       request: "GetAccessToken",                sloMs:  200 },
  { step: "ConsumerFlow_v4_Int",       request: "02_AddConsumer",                sloMs:  500 },
  { step: "ConsumerFlow_v4_Int",       request: "03_GetConsDtl_Single_v4",       sloMs:  100 },
  { step: "ConsumerFlow_v4_Int",       request: "04_DelConsumer_v4",             sloMs:  100 },
  { step: "FileBill_v4_Int",           request: "01_GetAccessToken",             sloMs:  200 },
  { step: "FileBill_v4_Int",           request: "02_FileBill",                   sloMs:  300 },
  { step: "GetMerchDtl_v4_Int",        request: "01_GetAccessToken",             sloMs:  200 },
  { step: "GetMerchDtl_v4_Int",        request: "02_GetMerchDtl",                sloMs:  500 },

  // ── Small Business (SB) REST variants ──────────────────────────────────────
  { step: "AddFundProFlow_SB",         request: "01_GetAccessToken",             sloMs:  900 },
  { step: "AddFundProFlow_SB",         request: "02_AddFundingBankAccount",      sloMs:  950 },
  { step: "AddFundProFlow_SB",         request: "03_UpdateFundingProfile",       sloMs:  550 },
  { step: "AddFundProFlow_SB",         request: "04_DeleteFundingProfile",       sloMs:  650 },
  { step: "Alerts_SB",                 request: "01_GetAccessToken",             sloMs:  900 },
  { step: "Alerts_SB",                 request: "02_Update_Alert_Pref",          sloMs:  450 },
  { step: "Alerts_SB",                 request: "03_UpdateAlertTypePref",        sloMs:  450 },
  { step: "Alerts_SB",                 request: "04_GetAlertDetailsAll",         sloMs:  750 },
  { step: "ApprovePayment_SB",         request: "01_GetAccessToken",             sloMs:  900 },
  { step: "ApprovePayment_SB",         request: "02_ApprovePayment",             sloMs:  450 },
  { step: "ConsumerFlow_SB",           request: "01_GetAccessToken",             sloMs:  900 },
  { step: "ConsumerFlow_SB",           request: "02_AddConsumer",                sloMs:  950 },
  { step: "ConsumerFlow_SB",           request: "03_GetAccessToken_1",           sloMs:  900 },
  { step: "ConsumerFlow_SB",           request: "04_AddUser",                    sloMs:  450 },
  { step: "ConsumerFlow_SB",           request: "05_UpdateUser",                 sloMs:  450 },
  { step: "ConsumerFlow_SB",           request: "06_DeleteUser",                 sloMs:  450 },
  { step: "ConsumerFlow_SB",           request: "07_GetConsumer",                sloMs:  550 },
  { step: "ConsumerFlow_SB",           request: "08_DeleteConsumer",             sloMs:  650 },
  { step: "EntitlementsFlow_SB",       request: "01_GetAccessToken",             sloMs:  900 },
  { step: "EntitlementsFlow_SB",       request: "02_AddUpdateEntitlement",       sloMs:  450 },
  { step: "EntitlementsFlow_SB",       request: "03_GetEntitlements",            sloMs:  450 },
  { step: "GetAudits_SB",              request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetAudits_SB",              request: "02_GetAuditFundProfile",        sloMs:  450 },
  { step: "GetAudits_SB",              request: "03_GetAuditPayee",              sloMs:  450 },
  { step: "GetAudits_SB",              request: "04_GetAuditPayment",            sloMs:  450 },
  { step: "GetConsDtl_SB",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetConsDtl_SB",             request: "02_GetComsumerDetails",         sloMs:  450 },
  { step: "GetFundPro_SB",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetFundPro_SB",             request: "02_GetFundingProfileAll",       sloMs:  450 },
  { step: "GetFundPro_SB",             request: "03_GetFundingProfileSingle",    sloMs:  450 },
  { step: "GetPayeeDtl_SB",            request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPayeeDtl_SB",            request: "02_GetPayeeInfoSingle",         sloMs:  450 },
  { step: "GetPayeeDtl_SB",            request: "03_GetPayeeInfoAll",            sloMs:  450 },
  { step: "GetPymtDtl_SB",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetPymtDtl_SB",             request: "02_GetPaymentSingle",           sloMs:  450 },
  { step: "GetPymtDtl_SB",             request: "03_GetPaymentsAll",             sloMs:  450 },
  { step: "GetUserDetails_SB",         request: "01_GetAccessToken",             sloMs:  900 },
  { step: "GetUserDetails_SB",         request: "02_GetUsersAll",                sloMs:  450 },
  { step: "GetUserDetails_SB",         request: "03_GetUserSingle",              sloMs:  450 },
  { step: "PayeeFlow_ManAdd_SB",       request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManAdd_SB",       request: "02_AddManagedAddPayee",         sloMs: 1250 },
  { step: "PayeeFlow_ManAdd_SB",       request: "03_UpdateManagedAddPayee",      sloMs: 1250 },
  { step: "PayeeFlow_ManAdd_SB",       request: "04_DeleteManagedAddPayee",      sloMs:  550 },
  { step: "PayeeFlow_ManGlobal_SB",    request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManGlobal_SB",    request: "02_AddManagedGlobalPayee",      sloMs: 1250 },
  { step: "PayeeFlow_ManGlobal_SB",    request: "03_UpdateManagedGlobalPayee",   sloMs: 1250 },
  { step: "PayeeFlow_ManGlobal_SB",    request: "04_DeleteManagedGlobalPayee",   sloMs:  550 },
  { step: "PayeeFlow_ManRegional_SB",  request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_ManRegional_SB",  request: "02_AddManagedRegionalPayee",    sloMs: 1250 },
  { step: "PayeeFlow_ManRegional_SB",  request: "03_UpdateManagedRegionalPayee", sloMs: 1250 },
  { step: "PayeeFlow_ManRegional_SB",  request: "04_DeleteManagedRegionalPayee", sloMs:  550 },
  { step: "PayeeFlow_PerCheck_SB",     request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PayeeFlow_PerCheck_SB",     request: "02_AddCheckPayee",              sloMs: 1250 },
  { step: "PayeeFlow_PerCheck_SB",     request: "03_Update",                     sloMs:  500 },
  { step: "PayeeFlow_PerCheck_SB",     request: "04_DeleteCheckPayee",           sloMs:  550 },
  { step: "PaymentFlow_Check_SB",      request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PaymentFlow_Check_SB",      request: "02_AddPaymentCheck",            sloMs:  750 },
  { step: "PaymentFlow_Check_SB",      request: "03_UpdatePaymentCheck",         sloMs:  750 },
  { step: "PaymentFlow_Check_SB",      request: "04_DeletePaymentCheck",         sloMs:  450 },
  { step: "PaymentFlow_Electronic_SB", request: "01_GetAccessToken",             sloMs:  900 },
  { step: "PaymentFlow_Electronic_SB", request: "02_AddPaymentElectronic",       sloMs:  750 },
  { step: "PaymentFlow_Electronic_SB", request: "03_UpdatePaymentElectronic",    sloMs:  750 },
  { step: "PaymentFlow_Electronic_SB", request: "04_DeletePaymentElectronic",    sloMs:  450 },
  { step: "SSO_Flow_SB",               request: "01_GetAccessToken",             sloMs:  900 },
  { step: "SSO_Flow_SB",               request: "02_SSO",                        sloMs:  450 },
  { step: "SSO_Flow_SB",               request: "03_AuditSignOn",                sloMs:  450 },
  { step: "UpdConsDtl_SB",             request: "01_GetAccessToken",             sloMs:  900 },
  { step: "UpdConsDtl_SB",             request: "02_UpdateConsumer",             sloMs:  950 },

  // ── Fusion UI Test Scripts ──────────────────────────────────────────────────
  { step: "AddBusPerPayee",   request: "01_Login",                   sloMs: 6000 },
  { step: "AddBusPerPayee",   request: "02_AddRecipient",            sloMs: 1000 },
  { step: "AddBusPerPayee",   request: "03_AddRecipientContinue",    sloMs: 2000 },
  { step: "AddBusPerPayee",   request: "04_AddRecipientContinue2",   sloMs: 3500 },
  { step: "AddBusPerPayee",   request: "05_RecipientLink",           sloMs: 2000 },
  { step: "AddBusPerPayee",   request: "06_SelectRecipient",         sloMs: 1000 },
  { step: "AddBusPerPayee",   request: "07_DeleteRecipient",         sloMs: 1000 },
  { step: "AddBusPerPayee",   request: "08_Delete",                  sloMs: 3000 },
  { step: "AddDeleteAutoPay", request: "01_Login",                   sloMs: 6000 },
  { step: "AddDeleteAutoPay", request: "02_RecipientsLink",          sloMs: 2000 },
  { step: "AddDeleteAutoPay", request: "03_SelectPayee",             sloMs: 1000 },
  { step: "AddDeleteAutoPay", request: "04_ModifyLink",              sloMs: 1000 },
  { step: "AddDeleteAutoPay", request: "05_PayAutomatically",        sloMs: 2000 },
  { step: "AddDeleteAutoPay", request: "06_SelectPayee",             sloMs: 1000 },
  { step: "AddDeleteAutoPay", request: "07_ModifyLink",              sloMs: 1000 },
  { step: "AddDeleteAutoPay", request: "08_DeleteAutoPay",           sloMs: 2000 },
  { step: "AddDeleteReminder", request: "01_Login",                  sloMs: 6000 },
  { step: "AddDeleteReminder", request: "02_RecipientsLink",         sloMs: 2000 },
  { step: "AddDeleteReminder", request: "03_SelectPayee",            sloMs: 1000 },
  { step: "AddDeleteReminder", request: "04_ModifyLink",             sloMs: 1000 },
  { step: "AddDeleteReminder", request: "05_AddReminder",            sloMs: 3000 },
  { step: "AddDeleteReminder", request: "06_SelectPayee",            sloMs: 1000 },
  { step: "AddDeleteReminder", request: "07_ModifyLink",             sloMs: 1000 },
  { step: "AddDeleteReminder", request: "08_DeleteReminder",         sloMs: 3000 },
  { step: "AddGlobalMerchPayee", request: "01_Login",                sloMs: 6000 },
  { step: "AddGlobalMerchPayee", request: "02_AddRecipient",         sloMs: 1000 },
  { step: "AddGlobalMerchPayee", request: "03_AddRecipientContinue", sloMs: 2000 },
  { step: "AddGlobalMerchPayee", request: "04_AddRecipientContinue2", sloMs: 3000 },
  { step: "AddGlobalMerchPayee", request: "05_RecipientLink",        sloMs: 2000 },
  { step: "AddGlobalMerchPayee", request: "06_SelectRecipient",      sloMs: 1000 },
  { step: "AddGlobalMerchPayee", request: "07_DeleteRecipient",      sloMs: 1000 },
  { step: "AddGlobalMerchPayee", request: "08_Delete",               sloMs: 3000 },
  { step: "AddManagedPayee",  request: "01_Login",                   sloMs: 6000 },
  { step: "AddManagedPayee",  request: "02_AddRecipient",            sloMs: 1000 },
  { step: "AddManagedPayee",  request: "03_AddRecipientContinue",    sloMs: 2000 },
  { step: "AddManagedPayee",  request: "04_AddRecipientContinue2",   sloMs: 3000 },
  { step: "AddManagedPayee",  request: "05_Skip",                    sloMs: 2000 },
  { step: "AddManagedPayee",  request: "06_RecipientsLink",          sloMs: 2000 },
  { step: "AddManagedPayee",  request: "07_SelectRecipient",         sloMs: 1000 },
  { step: "AddManagedPayee",  request: "08_DeleteRecipient",         sloMs: 1000 },
  { step: "AddManagedPayee",  request: "09_Delete",                  sloMs: 3000 },
  { step: "AddPersonalPayee", request: "01_Login",                   sloMs: 6000 },
  { step: "AddPersonalPayee", request: "02_AddRecipient",            sloMs: 1000 },
  { step: "AddPersonalPayee", request: "04_AddRecipientContinue2",   sloMs: 3000 },
  { step: "AddPersonalPayee", request: "05_RecipientLink",           sloMs: 2000 },
  { step: "AddPersonalPayee", request: "06_SelectRecipient",         sloMs: 1000 },
  { step: "AddPersonalPayee", request: "07_DeleteRecipient",         sloMs: 1000 },
  { step: "AddPersonalPayee", request: "08_Delete",                  sloMs: 3000 },
  { step: "Login",            request: "01_Login",                   sloMs: 6000 },
  { step: "LoginTabs",        request: "01_Login",                   sloMs: 6000 },
  { step: "LoginTabs",        request: "02_MenuViewActivity",        sloMs: 2000 },
  { step: "LoginTabs",        request: "03_MenuViewActivityHistory", sloMs: 2000 },
  { step: "LoginTabs",        request: "04_MenuViewActivityHistoryPage2", sloMs: 2000 },
  { step: "LoginTabs",        request: "05_Menu_ManageFundAccts",    sloMs: 2000 },
  { step: "LoginTabs",        request: "06_Menu_ManageRecipients",   sloMs: 2000 },
  { step: "LoginTabs",        request: "07_Menu_ManageRecipientsPage2", sloMs: 2000 },
  { step: "LoginTabs",        request: "08_MenuPay",                 sloMs: 3000 },
  { step: "LoginTabs",        request: "09_MenuPayPage2",            sloMs: 3000 },
  { step: "MakeUpdatePymnt",  request: "01_Login",                   sloMs: 6000 },
  { step: "MakeUpdatePymnt",  request: "02_SendPayment",             sloMs: 3000 },
  { step: "MakeUpdatePymnt",  request: "03_ActivityLink",            sloMs: 2000 },
  { step: "MakeUpdatePymnt",  request: "04_EditPymntBtn",            sloMs: 1000 },
  { step: "MakeUpdatePymnt",  request: "05_SavePymnt",               sloMs: 2000 },
  { step: "MakeUpdatePymnt",  request: "06_CancelPymntBtn",          sloMs: 1000 },
  { step: "MakeUpdatePymnt",  request: "07_CancelPymnt",             sloMs: 2000 },
  { step: "ModifyFundAcct",   request: "01_Login",                   sloMs: 6000 },
  { step: "ModifyFundAcct",   request: "02_AccountsLink",            sloMs: 2000 },
  { step: "ModifyFundAcct",   request: "03_SelectFundAcct",          sloMs: 1000 },
  { step: "ModifyFundAcct",   request: "04_ModifyBtn",               sloMs: 1000 },
  { step: "ModifyFundAcct",   request: "05_SaveBtn",                 sloMs: 2000 },
  { step: "ModifyPayeeActNbr", request: "01_Login",                  sloMs: 6000 },
  { step: "ModifyPayeeActNbr", request: "02_RecipientsLink",         sloMs: 2000 },
  { step: "ModifyPayeeActNbr", request: "03_SelectRecipient",        sloMs: 1000 },
  { step: "ModifyPayeeActNbr", request: "04_ModifyLink",             sloMs: 2000 },
  { step: "ModifyPayeeActNbr", request: "05_ModifySave",             sloMs: 2000 },
  { step: "ModifyPayeeActNbr", request: "06_ModifyLink2",            sloMs: 2000 },
  { step: "ModifyPayeeActNbr", request: "07_ModifySave2",            sloMs: 2000 },
  { step: "MultiPymnts",      request: "01_Login",                   sloMs: 6000 },
  { step: "MultiPymnts",      request: "02_ConfirmPymnts",           sloMs: 1000 },
  { step: "MultiPymnts",      request: "03_Continue",                sloMs: 3500 },
  { step: "MultiPymnts",      request: "04_Close",                   sloMs: 1000 },
  { step: "MultiPymnts",      request: "05_ActivityLink",            sloMs: 2000 },
  { step: "MultiPymnts",      request: "06_CancelPymntBtn1",         sloMs: 1000 },
  { step: "MultiPymnts",      request: "07_CancelPymnt1",            sloMs: 1000 },
  { step: "MultiPymnts",      request: "08_CancelPymntBtn2",         sloMs: 1000 },
  { step: "MultiPymnts",      request: "09_CancelPymnt2",            sloMs: 1000 },
  { step: "MultiPymnts",      request: "10_PayLink",                 sloMs: 3000 },
  { step: "UpdateReminder",   request: "01_Login",                   sloMs: 6000 },
  { step: "UpdateReminder",   request: "02_RecipientsLink",          sloMs: 2000 },
  { step: "UpdateReminder",   request: "03_SelectPayee",             sloMs: 1000 },
  { step: "UpdateReminder",   request: "04_ModifyReminder",          sloMs: 1000 },
  { step: "UpdateReminder",   request: "05_SaveBtn",                 sloMs: 3000 },

  // ── BPM Retail Services (SOAP) ─────────────────────────────────────────────
  { step: "AddConsFlow",        request: "01_AddCons",             sloMs:  500 },
  { step: "AddConsFlow",        request: "02_DelCons",             sloMs:  100 },
  { step: "CategoryFlow",       request: "01_AddCat",              sloMs:  150 },
  { step: "CategoryFlow",       request: "02_DelCat",              sloMs:  150 },
  { step: "ConsPayeeFlow",      request: "01_GetConsDtl",          sloMs:  150 },
  { step: "ConsPayeeFlow",      request: "02_AddPayee",            sloMs:  500 },
  { step: "ConsPayeeFlow",      request: "03_DelPayee",            sloMs:  150 },
  { step: "FundAcctFlow",       request: "01_AddFundAcct",         sloMs:  350 },
  { step: "FundAcctFlow",       request: "02_DelFundAcct",         sloMs:  300 },
  { step: "GetBillDtls",        request: "01_GetBillDtls",         sloMs:  150 },
  { step: "GetCatDtls",         request: "01_GetCatDtls",          sloMs:  100 },
  { step: "GetConsDtls",        request: "01_GetConsDtls",         sloMs:  100 },
  { step: "GetFIDtls",          request: "01_GetFiDtls",           sloMs:  250 },
  { step: "GetFundAcctDtls",    request: "01_GetFundDtls",         sloMs:  100 },
  { step: "GetMerchDtls_All",   request: "01_GetMerchDtls_1",      sloMs:  100 },
  { step: "GetMerchDtls_All",   request: "02_GetMerchDtls_3",      sloMs:  200 },
  { step: "GetMerchDtls_All",   request: "03_GetMerchDtls_6",      sloMs:  200 },
  { step: "GetPayeeDtls_All",   request: "01_GetPayeeDtls_All",    sloMs:  300 },
  { step: "GetPayeeDtls_Single", request: "01_GetPayeeDtls_Sgl",   sloMs:  100 },
  { step: "GetPaymtDtls",       request: "01_GetPaymtDtls",        sloMs:  250 },
  { step: "GetPaymtOpts",       request: "01_GetPymntOpt",         sloMs:  100 },
  { step: "GetPersonalization", request: "01_GetPerszn",           sloMs:  100 },
  { step: "GetUserDtls",        request: "01_GetUserDtls",         sloMs:  100 },
  { step: "PaymentFlow_DD",     request: "01_AddPaymt_DD",         sloMs:  350 },
  { step: "PaymentFlow_DD",     request: "02_DelPaymt_DD",         sloMs:  100 },
  { step: "PaymentFlow_SD",     request: "01_AddPaymt_SD",         sloMs:  250 },
  { step: "PaymentFlow_SD",     request: "02_DelPaymt_SD",         sloMs:  100 },
  { step: "SSO_Flow",           request: "01_SsoLogon",            sloMs:  100 },
  { step: "SSO_Flow",           request: "02_SsoAudit",            sloMs:  100 },
  { step: "SSO_Flow",           request: "03_SsoLogout",           sloMs:  100 },
  { step: "SSO_Login_Audit",    request: "02_SsoAudit",            sloMs:  100 },
  { step: "UpdConsPayee",       request: "01_UpdConsPayee",        sloMs:  200 },
  { step: "UpdConsumer",        request: "02_UpdCons",             sloMs:  200 },
  { step: "UpdPayeeAcctNum",    request: "01_UpdPyeeAcctNum",      sloMs:  200 },
  { step: "UpdPayment",         request: "01_UpdPaymt",            sloMs:  100 },

  // ── BDE Services ───────────────────────────────────────────────────────────
  { step: "Enroll/Unenroll",    request: "Enroll",                 sloMs:  250 },
  { step: "Enroll/Unenroll",    request: "Unenroll",               sloMs:  450 },

  // ── External Transfers Services ────────────────────────────────────────────
  { step: "AddTransRule_Int-Ext_FD",      request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransRule_Int-Ext_FD",      request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransRule_Int-Ext_FD",      request: "AddTransRule",            sloMs: 600 },
  { step: "AddTransRule_Int-Ext_FD",      request: "GetTransRuleDtls",        sloMs: 200 },
  { step: "AddTransRule_Int-Ext_FD",      request: "UpdTransRule",            sloMs: 700 },
  { step: "AddTransRule_Int-Ext_FD",      request: "DelTransRule",            sloMs: 100 },
  { step: "AddTransferFees_Ext-Int_FD",   request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransferFees_Ext-Int_FD",   request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransferFees_Ext-Int_FD",   request: "AddTranFees_Ext-Int_FD",  sloMs: 350 },
  { step: "AddTransferFees_Ext-Int_FD",   request: "GetTransDtls",            sloMs: 100 },
  { step: "AddTransferFees_Ext-Int_FD",   request: "DelTrans",                sloMs: 100 },
  { step: "AddTransferFees_Int-Ext_FD",   request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransferFees_Int-Ext_FD",   request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransferFees_Int-Ext_FD",   request: "AddTranFees_Int-Ext_FD",  sloMs: 350 },
  { step: "AddTransferFees_Int-Ext_FD",   request: "GetTransDtls",            sloMs: 100 },
  { step: "AddTransferFees_Int-Ext_FD",   request: "DelTrans",                sloMs: 100 },
  { step: "AddTransfer_Ext-Int_FD",       request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransfer_Ext-Int_FD",       request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransfer_Ext-Int_FD",       request: "AddTran_Ext-Int_FD",      sloMs: 350 },
  { step: "AddTransfer_Ext-Int_FD",       request: "GetTransDtls",            sloMs: 100 },
  { step: "AddTransfer_Ext-Int_FD",       request: "DelTrans",                sloMs: 100 },
  { step: "AddTransfer_Ext-Int_SD",       request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransfer_Ext-Int_SD",       request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransfer_Ext-Int_SD",       request: "AddTran_Ext-Int_SD",      sloMs: 700 },
  { step: "AddTransfer_Ext-Int_SD",       request: "GetTransDtls",            sloMs: 100 },
  { step: "AddTransfer_Ext-Int_SD",       request: "DelTrans",                sloMs: 100 },
  { step: "AddTransfer_Int-Ext_FD",       request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransfer_Int-Ext_FD",       request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransfer_Int-Ext_FD",       request: "AddTran_Int-Ext_FD",      sloMs: 350 },
  { step: "AddTransfer_Int-Ext_FD",       request: "GetTransDtls",            sloMs: 100 },
  { step: "AddTransfer_Int-Ext_FD",       request: "DelTrans",                sloMs: 100 },
  { step: "AddTransfer_Int-Ext_SD",       request: "GetPymtMethPro",          sloMs: 100 },
  { step: "AddTransfer_Int-Ext_SD",       request: "GetTrandAcctDtl",         sloMs: 100 },
  { step: "AddTransfer_Int-Ext_SD",       request: "AddTran_Int-Ext_SD",      sloMs: 500 },
  { step: "AddTransfer_Int-Ext_SD",       request: "GetTransDtls",            sloMs: 100 },

  // ── People Pay Services ────────────────────────────────────────────────────
  { step: "AddConsFlow_DirectEnroll",  request: "AddCons",           sloMs:  500 },
  { step: "AddConsFlow_DirectEnroll",  request: "UpdCons",           sloMs:  200 },
  { step: "AddConsFlow_DirectEnroll",  request: "AddFundPro",        sloMs:  300 },
  { step: "AddConsFlow_DirectEnroll",  request: "GetFundDtls",       sloMs:  100 },
  { step: "AddConsFlow_DirectEnroll",  request: "DelCons",           sloMs:  200 },
  { step: "AddPaymentFlow_A2A",        request: "AddPmnt_A2A",       sloMs:  700 },
  { step: "AddPaymentFlow_A2A",        request: "GetPymtDtl_A2A",    sloMs:  100 },
  { step: "AddPaymentFlow_RC",         request: "AddPmnt_RC",        sloMs:  500 },
  { step: "AddPaymentFlow_RC",         request: "GetPymtDtl_RC",     sloMs:  100 },
  { step: "ConsumerPayeeFlow",         request: "GetConDtl_PayeeFlo", sloMs: 100 },
  { step: "ConsumerPayeeFlow",         request: "AddConsPayee",      sloMs:  250 },
  { step: "ConsumerPayeeFlow",         request: "UpdConsPayee",      sloMs:  200 },
  { step: "ConsumerPayeeFlow",         request: "AddPayeePro",       sloMs:  450 },
  { step: "ConsumerPayeeFlow",         request: "UpdPayeePro",       sloMs:  250 },
  { step: "ConsumerPayeeFlow",         request: "GetPayeePro",       sloMs:  100 },
  { step: "ConsumerPayeeFlow",         request: "DelConsPayee",      sloMs:  500 },
  { step: "FundingAcctFlow",           request: "AddFundAcct",       sloMs:  300 },
  { step: "FundingAcctFlow",           request: "GetFundDtls",       sloMs:  100 },
  { step: "FundingAcctFlow",           request: "DelFundAcct",       sloMs:  250 },
  { step: "GetConsumerDetails",        request: "GetConsDetails",    sloMs:  100 },
  { step: "GetConsumerPayee_All",      request: "GetConsPayee_All",  sloMs:  200 },
  { step: "GetConsumerPayee_Single",   request: "GetPayeeDet_Sgl",   sloMs:  100 },
  { step: "GetFundingAccountDetails",  request: "GetFundAcctDtls",   sloMs:  100 },
  { step: "GetPaymntDtls",             request: "GetPaymentDtls",    sloMs:  100 },
  { step: "UptConsumer",               request: "UpdConsumer",       sloMs:  200 },

  // ── Zelle Services ─────────────────────────────────────────────────────────
  { step: "AddConsFlow",        request: "02_UpdCons_Z",            sloMs:  300 },
  { step: "AddConsFlow",        request: "03_AddFundAcct_Z",        sloMs:  200 },
  { step: "AddConsFlow",        request: "04_DeleteCons_Z",         sloMs:  300 },
  { step: "AddCont_Reg",        request: "02_AddContMbl_Reg_Z",     sloMs:  350 },
  { step: "AddCont_Unreg",      request: "02_AddContMbl_Unreg_Z",   sloMs:  350 },
  { step: "AddPymt_Reg",        request: "02_AddPymtMbl_Reg_Z",     sloMs:  450 },
  { step: "AddPymt_Unreg",      request: "02_AddPymtMbl_Unreg_Z",   sloMs:  450 },
  { step: "RiskInsightsPymtFlow", request: "02_UpdatePymtDtlsRI_Z", sloMs:  400 },

  // ── PeoplePay UI Test ──────────────────────────────────────────────────────
  { step: "AContactPymnt",  request: "01_Login",                    sloMs: 7000 },
  { step: "AContactPymnt",  request: "02_Skip",                     sloMs: 2000 },
  { step: "AContactPymnt",  request: "03_EnterPayeeContinue",       sloMs: 1500 },
  { step: "AContactPymnt",  request: "04_Done",                     sloMs: 1000 },
  { step: "AContactPymnt",  request: "05_Next",                     sloMs: 1500 },
  { step: "AContactPymnt",  request: "06_Review",                   sloMs: 1000 },
  { step: "AContactPymnt",  request: "07_Send",                     sloMs: 1000 },
  { step: "AContactPymnt",  request: "08_SendYes",                  sloMs: 2000 },
  { step: "AContactPymnt",  request: "09_AllDone",                  sloMs: 1000 },
  { step: "ADEmailPhone",   request: "01_Login",                    sloMs: 7000 },
  { step: "ADEmailPhone",   request: "02_Skip",                     sloMs: 2000 },
  { step: "ADEmailPhone",   request: "03_SettingLink",              sloMs:  500 },
  { step: "ADEmailPhone",   request: "04_AddMobile",                sloMs:  500 },
  { step: "ADEmailPhone",   request: "05_AddMobileContinue",        sloMs: 3000 },
  { step: "ADEmailPhone",   request: "06_AddMobileTransfer",        sloMs: 1000 },
  { step: "ADEmailPhone",   request: "07_VerifyCodeMobile",         sloMs: 5000 },
  { step: "ADEmailPhone",   request: "08_DeleteMobileNbr",          sloMs: 1000 },
  { step: "ADEmailPhone",   request: "09_DeleteLink",               sloMs: 1000 },
  { step: "ADEmailPhone",   request: "10_AddEmail",                 sloMs:  500 },
  { step: "ADEmailPhone",   request: "11_AddEmailContinue",         sloMs: 5000 },
  { step: "ADEmailPhone",   request: "12_AddEmailTransfer",         sloMs: 1000 },
  { step: "ADEmailPhone",   request: "13_VerifyEmail",              sloMs: 2500 },
  { step: "ADEmailPhone",   request: "14_DeleteEmail",              sloMs: 1000 },
  { step: "ADEmailPhone",   request: "15_Delete",                   sloMs:  500 },
  { step: "Activity",       request: "01_Login",                    sloMs: 7000 },
  { step: "Activity",       request: "02_Skip",                     sloMs: 2000 },
  { step: "Activity",       request: "03_ActivityLink",             sloMs:  500 },
  { step: "Activity",       request: "04_ActivityLink_ViewMore",    sloMs:  500 },
  { step: "Activity",       request: "05_PaymentsLink",             sloMs:  500 },
  { step: "Activity",       request: "06_PaymentsLink_ViewMore",    sloMs:  500 },
  { step: "Activity",       request: "07_RequestsLink",             sloMs:  500 },
  { step: "Activity",       request: "08_Send",                     sloMs: 1000 },
  { step: "QRCodePymnt",    request: "01_Login",                    sloMs: 7000 },
  { step: "QRCodePymnt",    request: "02_Skip",                     sloMs: 2000 },
  { step: "QRCodePymnt",    request: "03_Scan",                     sloMs: 1000 },
  { step: "QRCodePymnt",    request: "04_Open",                     sloMs: 1000 },
  { step: "QRCodePymnt",    request: "05_AddContinue",              sloMs: 1500 },
  { step: "QRCodePymnt",    request: "06_Review",                   sloMs: 1000 },
  { step: "QRCodePymnt",    request: "07_SendPymnt",                sloMs: 1000 },
  { step: "QRCodePymnt",    request: "08_Yes",                      sloMs: 1500 },
  { step: "QRCodePymnt",    request: "09_AllDone",                  sloMs: 1000 },
  { step: "QRCodePymnt",    request: "10_Edit",                     sloMs:  500 },
  { step: "QRCodePymnt",    request: "11_Delete",                   sloMs:  500 },
  { step: "QRCodePymnt",    request: "12_Delete2",                  sloMs: 1000 },
  { step: "ReqPymnt",       request: "01_Login",                    sloMs: 7000 },
  { step: "ReqPymnt",       request: "02_Skip",                     sloMs: 2000 },
  { step: "ReqPymnt",       request: "03_Request",                  sloMs:  500 },
  { step: "ReqPymnt",       request: "04_SelctPayee",               sloMs: 1000 },
  { step: "ReqPymnt",       request: "05_ReviewBtn",                sloMs: 1000 },
  { step: "ReqPymnt",       request: "06_RequestBtn",               sloMs: 1000 },
  { step: "ReqPymnt",       request: "07_AllDone",                  sloMs: 1000 },
  { step: "SendPaymentRI",  request: "01_Login",                    sloMs: 7000 },
  { step: "SendPaymentRI",  request: "02_Skip",                     sloMs: 2000 },
  { step: "SendPaymentRI",  request: "03_SelectContact",            sloMs: 1000 },
  { step: "SendPaymentRI",  request: "04_ReviewPayment",            sloMs: 1000 },
  { step: "SendPaymentRI",  request: "05_SendPayment",              sloMs: 1500 },
  { step: "SendPaymentRI",  request: "06_SendItAnyway",             sloMs: 1500 },
  { step: "SendPaymentRI",  request: "07_AllDone",                  sloMs: 1000 },
  { step: "SendPaymentSMS", request: "Login",                       sloMs: 7000 },
  { step: "SendPaymentSMS", request: "02_Skip",                     sloMs: 2000 },
  { step: "SendPaymentSMS", request: "03_SelectContact",            sloMs: 1000 },
  { step: "SendPaymentSMS", request: "04_ReviewPayment",            sloMs: 1000 },
  { step: "SendPaymentSMS", request: "05_SendPayment",              sloMs: 1500 },
  { step: "SendPaymentSMS", request: "06_AllDone",                  sloMs: 1000 },
  { step: "SendPymnt",      request: "01_Login",                    sloMs: 7000 },
  { step: "SendPymnt",      request: "02_Skip",                     sloMs: 2000 },
  { step: "SendPymnt",      request: "03_SendLink",                 sloMs:  500 },
  { step: "SendPymnt",      request: "04_SelectContact",            sloMs: 1000 },
  { step: "SendPymnt",      request: "05_ReviewPymnt",              sloMs: 1000 },
  { step: "SendPymnt",      request: "06_SendPaymnt",               sloMs: 1500 },
  { step: "SendPymnt",      request: "07_AllDone",                  sloMs: 1000 },
  { step: "Split",          request: "01_login",                    sloMs: 7000 },
  { step: "Split",          request: "02_Skip",                     sloMs: 2000 },
  { step: "Split",          request: "03_Split",                    sloMs:  500 },
  { step: "Split",          request: "04_SelectPayee",              sloMs: 1000 },
  { step: "Split",          request: "05_EnterValue",               sloMs: 1000 },
  { step: "Split",          request: "06_Review",                   sloMs: 1000 },
  { step: "Split",          request: "07_SplitBtn",                 sloMs: 1500 },
  { step: "Split",          request: "08_AllDone",                  sloMs: 1500 },

  // ── PM2 UI Test ───────────────────────────────────────────────────────────
  { step: "AddDeleteContact", request: "Login",                     sloMs: 6000 },
  { step: "AddDeleteContact", request: "PaySomeoneNew",             sloMs: 2000 },
  { step: "AddDeleteContact", request: "AddBiller",                 sloMs: 3500 },
  { step: "AddDeleteContact", request: "Confirm",                   sloMs: 3000 },
  { step: "AddDeleteContact", request: "PayThisBiller",             sloMs: 1000 },
  { step: "AddDeleteContact", request: "SelectBiller",              sloMs: 1000 },
  { step: "AddDeleteContact", request: "Delete",                    sloMs: 1000 },
  { step: "AddDeleteContact", request: "DeleteBtn",                 sloMs: 3000 },

  // ── CST UI Test ───────────────────────────────────────────────────────────
  { step: "LoginLogout",    request: "01_LaunchPage",               sloMs: 1500 },
  { step: "LoginLogout",    request: "02_SignIn",                   sloMs:  500 },
  { step: "LoginLogout",    request: "03_AUthPIN_Logon",            sloMs: 2000 },
  { step: "LoginLogout",    request: "04_LogOut",                   sloMs:  500 },

];
