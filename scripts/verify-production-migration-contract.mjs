import { readFileSync, existsSync } from "node:fs";

const expected = new Map([
  ["supabase/migrations/20260815173217_harden_customer_account_identity_link.sql", ["link_current_customer_account"]],
  ["supabase/migrations/20260815173914_enforce_customer_profile_identity_invariants.sql", ["profile_id"]],
  ["supabase/migrations/20260815174444_sync_customer_profile_on_master_transfer.sql", ["master_transfer_customer"]],
  ["supabase/migrations/20260815174536_fix_master_transfer_schema_compat.sql", ["master_transfer_customer"]],
  ["supabase/migrations/20260815235602_financial_reversal_ledger_hardening.sql", ["reverse_customer_wallet_topup", "chargeback_debt_cents"]],
  ["supabase/migrations/20260816000030_settle_wallet_chargeback_debt_on_topup.sql", ["credit_customer_wallet", "chargeback_debt_cents"]],
  ["supabase/migrations/20260816000701_canonical_customer_quote_decision_lifecycle.sql", ["customer_decide_quote", "respond_company_referral"]],
  ["supabase/migrations/20260816003825_canonical_billing_contract_tax_and_fee_rules.sql", ["tax_rate_basis_points", "save_customer_billing_agreement"]],
  ["supabase/migrations/20260816003910_activate_after_visit_billing_events.sql", ["materialize_visit_billing_invoice", "process_visit_billing_events"]],
  ["supabase/migrations/20260816004315_reconcile_visit_payments_with_weekly_payouts.sql", ["reconcile_visit_payment_to_payout", "refresh_payout_release_status"]],
  ["supabase/migrations/20260816004422_schedule_visit_billing_processor.sql", ["process-visit-billing-events-hourly", "pg_cron"]],
  ["supabase/migrations/20260816010204_add_account_balance_payment_method.sql", ["account_balance"]],
  ["supabase/migrations/20260816010552_enable_account_balance_invoice_payments.sql", ["pay_customer_invoice_from_wallet", "customer_wallet_service_invoice_unique"]],
  ["supabase/migrations/20260816020103_admin_workspace_payment_and_temporary_access.sql", ["temporary_test_accounts", "get_admin_task_properties", "get_admin_alert_center", "get_payments_contract_workspace"]],
  ["supabase/migrations/20260816021540_temporary_test_account_fk_indexes.sql", ["temporary_test_accounts_created_by_master_idx", "temporary_test_accounts_customer_idx", "temporary_test_accounts_employee_idx"]],
]);

for (const [path, fragments] of expected) {
  if (!existsSync(path)) throw new Error(`Missing exact production migration: ${path}`);
  const source = readFileSync(path, "utf8").toLowerCase();
  for (const fragment of fragments) {
    if (!source.includes(fragment.toLowerCase())) {
      throw new Error(`${path} is missing contract fragment: ${fragment}`);
    }
  }
}

console.log(`Verified ${expected.size} exact production migration sources.`);
