-- Pledger and organizer messages move from SMS to WhatsApp (SMS remains the fallback).

-- Language the pledger used when pledging, so receipts and reminders arrive in that language.
ALTER TABLE pledgers ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';

-- Delivery tracking from WhatsApp status webhooks, and whether an SMS fallback was already sent.
ALTER TABLE messages_log ADD COLUMN delivery_status TEXT;   -- sent | delivered | read | failed
ALTER TABLE messages_log ADD COLUMN fallback_sent BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX messages_log_ref_idx ON messages_log(provider_ref);

-- The per-event WhatsApp switch is replaced by one admin setting (whatsapp_messages_enabled).
ALTER TABLE events DROP COLUMN whatsapp_reminders;
