# EasyDesign photoreal renderer

Secure backend for EasyRack EasyDesign PDF photoreal warehouse visualisations.

## What it does
The EasyDesign browser page sends two generated reference images plus the design facts to POST /render. The worker calls the OpenAI image edit endpoint using GPT Image 1 and returns a JPEG data URL. The browser then places that image into the PDF.

## GitHub Actions deployment
Add these repository secrets before running the workflow:

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- OPENAI_API_KEY

Then merge this branch to main or run the "Deploy EasyDesign photoreal renderer" workflow manually.

After Cloudflare deploys the worker, copy the resulting workers.dev URL and use:
https://YOUR-WORKER-URL.workers.dev/render

in the EasyDesign HTML as PHOTOREAL_API_URL.

## Security
The OpenAI API key is never present in Odoo or browser JavaScript.
CORS is restricted to easyrack.net and www.easyrack.net.
