Twilio webhook for inbound SMS and WhatsApp. Verifies X-Twilio-Signature with TWILIO_AUTH_TOKEN, then calls dv_record_inbound,
which links the message to the one live case whose phone number matches (else parks it as unassigned). Retries are safe (MessageSid dedupe).
