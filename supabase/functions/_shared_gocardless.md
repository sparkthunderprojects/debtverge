Shared notes for the GoCardless functions (each function is self-contained so it can be deployed on its own).
Secrets (Supabase Dashboard > Edge Functions > Secrets):
  GOCARDLESS_ACCESS_TOKEN   access token from the GoCardless dashboard (sandbox or live)
  GOCARDLESS_ENV            "sandbox" or "live" (default sandbox)
  GOCARDLESS_WEBHOOK_SECRET the secret set on the webhook endpoint in GoCardless
  APP_BASE_URL              the published site, e.g. https://sparkthunderprojects-1dvy.bolt.host
Webhook endpoint to register in GoCardless: https://<project-ref>.supabase.co/functions/v1/gocardless-webhook
