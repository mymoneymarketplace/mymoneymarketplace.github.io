# Deploy the MMM lead-capture Worker

Runs on Cloudflare Workers. Free tier easily covers this volume.

## One-time setup

```bash
# From the project root:
cd worker

# Install Wrangler once (global OR local). Global is simplest:
npm install -g wrangler

# Log in -- opens a browser to OAuth with your Cloudflare account.
wrangler login
```

## Set secrets

Values come from the `.env` file at the repo root. Paste each value when
prompted (Wrangler reads from stdin so copy/paste works):

```bash
wrangler secret put RESEND_API_KEY
wrangler secret put ZAPIER_WEBHOOK_URL
wrangler secret put FROM_EMAIL
```

## Deploy

```bash
wrangler deploy
```

On success Wrangler prints a URL like:

```
https://mmm-lead-capture.<your-subdomain>.workers.dev
```

Copy that URL -- you'll need it for the next step.

## Point the site forms at the Worker

From the repo root:

```bash
node update-forms-to-worker.js https://mmm-lead-capture.<your-subdomain>.workers.dev/capture-lead
```

That rewrites the inline form JS on all 264 pages to POST to your Worker
instead of hitting Zapier directly, then you commit + push as usual.

## Smoke test

```bash
curl -X POST "https://mmm-lead-capture.<your-subdomain>.workers.dev/capture-lead" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","email":"<your-email>","referrerPage":"/personal-loans-for-bad-credit-2026.html","utmCampaign":"smoke-test"}'
```

Expect: `{"success":true,"message":"Lead captured and email sent"}` and a
real welcome email in the inbox you specified.
