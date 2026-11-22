send-comms: deployed to Supabase (verify_jwt off, authenticates with x-comms-secret = COMMS_CRON_SECRET).
Sends queued comms_outbox rows via Resend (RESEND_API_KEY, EMAIL_FROM) and Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
With no provider secrets set, messages stay queued. Source of truth is the deployed function; export before editing.
