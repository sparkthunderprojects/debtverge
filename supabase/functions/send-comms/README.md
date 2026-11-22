Sends queued comms_outbox rows: email via Resend (RESEND_API_KEY, EMAIL_FROM), SMS and WhatsApp via Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, optional TWILIO_WHATSAPP_FROM).
Called by the scheduler with header x-comms-secret = COMMS_CRON_SECRET. Rows stay queued until a provider is configured.
The case conversation is updated by a database trigger (dv_mirror_outbox), not by this function.
