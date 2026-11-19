-- v1.31: database safety rules, so a mistake in code can never store a value the rest of the app cannot read.
--
-- 1. Allowed values for statuses, roles, kinds and accounts (the same lists the code uses).
--    Added NOT VALID: they apply to every new or changed row; rows saved before today are left exactly as they are
--    (nothing is rewritten or deleted).
-- 2. Every ledger journal must balance (debits = credits). Checked by the database itself when a transaction is
--    saved, not only by the app.
-- 3. Indexes for the lookups that grow with real use.

ALTER TABLE users ADD CONSTRAINT users_admin_role_ok CHECK (admin_role IS NULL OR admin_role IN ('super','finance','trust','support')) NOT VALID;
ALTER TABLE events ADD CONSTRAINT events_status_ok CHECK (status IN ('draft','active','closed')) NOT VALID;
ALTER TABLE events ADD CONSTRAINT events_privacy_ok CHECK (privacy IN ('hidden_list','public_list')) NOT VALID;
ALTER TABLE events ADD CONSTRAINT events_target_ok CHECK (target_amount IS NULL OR target_amount > 0) NOT VALID;
ALTER TABLE event_members ADD CONSTRAINT event_members_role_ok CHECK (role IN ('owner','treasurer','viewer')) NOT VALID;
ALTER TABLE pledges ADD CONSTRAINT pledges_plan_ok CHECK (pay_plan IN ('now','part','later')) NOT VALID;
ALTER TABLE pledges ADD CONSTRAINT pledges_source_ok CHECK (source IN ('self','committee','import')) NOT VALID;
ALTER TABLE pledges ADD CONSTRAINT pledges_message_status_ok CHECK (message_status IN ('pending','approved','hidden')) NOT VALID;
ALTER TABLE pledge_change_requests ADD CONSTRAINT pcr_status_ok CHECK (status IN ('pending','approved','rejected')) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_status_ok CHECK (status IN ('created','pending','succeeded','failed','expired','refunding','refunded')) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_purpose_ok CHECK (purpose IN ('pledge','event_pass','sms_credits')) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_method_ok CHECK (method IN ('mtn','airtel','card')) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_parts_ok CHECK (pledge_credit >= 0 AND fee >= 0 AND tip >= 0) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payments_pledge_has_pledge CHECK (purpose <> 'pledge' OR pledge_id IS NOT NULL) NOT VALID;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_ok CHECK (status IN ('awaiting_second_approval','in_review','processing','paid','failed','rejected')) NOT VALID;
ALTER TABLE payout_accounts ADD CONSTRAINT payout_accounts_kind_ok CHECK (kind IN ('mobile_money','bank')) NOT VALID;
ALTER TABLE reminders ADD CONSTRAINT reminders_status_ok CHECK (status IN ('scheduled','sent','skipped','failed')) NOT VALID;
ALTER TABLE reminders ADD CONSTRAINT reminders_channel_ok CHECK (channel IN ('sms','whatsapp')) NOT VALID;
ALTER TABLE verifications ADD CONSTRAINT verifications_status_ok CHECK (status IN ('pending','approved','rejected')) NOT VALID;
ALTER TABLE reports ADD CONSTRAINT reports_status_ok CHECK (status IN ('open','resolved')) NOT VALID;
ALTER TABLE reports ADD CONSTRAINT reports_source_ok CHECK (source IN ('user','system')) NOT VALID;
ALTER TABLE setting_proposals ADD CONSTRAINT setting_proposals_status_ok CHECK (status IN ('pending','approved','rejected')) NOT VALID;
ALTER TABLE support_requests ADD CONSTRAINT support_requests_status_ok CHECK (status IN ('open','waiting','resolved')) NOT VALID;
ALTER TABLE ledger_journals ADD CONSTRAINT ledger_journals_kind_ok CHECK (kind IN
  ('pledge','pledge_change','payment','manual_payment','payout_hold','payout_paid','refund_hold','reversal','pass','credits')) NOT VALID;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_ok CHECK (account IN
  ('receivable','pledge_income','organizer_cash','offline_cash','ahadi_cash','fee_expense','ahadi_fee_revenue','ahadi_tip_revenue',
   'ahadi_pass_revenue','ahadi_credit_revenue','payout_pending','refund_pending','paid_out')) NOT VALID;

-- Every journal balances, checked by the database at the end of the transaction that wrote it.
CREATE OR REPLACE FUNCTION ledger_journal_balances() RETURNS trigger AS $$
DECLARE s BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO s FROM ledger_entries WHERE journal_id = NEW.journal_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'ledger journal % does not balance (%)', NEW.journal_id, s;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_journal_balances();

-- Lookups that grow with real use.
CREATE INDEX IF NOT EXISTS pledges_pledger_idx ON pledges(pledger_id);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_idx ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS messages_log_event_idx ON messages_log(event_id, purpose);
CREATE INDEX IF NOT EXISTS messages_log_recipient_idx ON messages_log(recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_event_idx ON audit_logs(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_payment_idx ON payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS payments_event_idx ON payments(event_id, status);
CREATE INDEX IF NOT EXISTS payouts_event_idx ON payouts(event_id, status);
CREATE INDEX IF NOT EXISTS event_members_user_idx ON event_members(user_id);
CREATE INDEX IF NOT EXISTS reminders_pledge_idx ON reminders(pledge_id, status);
CREATE INDEX IF NOT EXISTS support_requests_phone_idx ON support_requests(phone);
