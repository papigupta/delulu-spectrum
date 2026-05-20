# Phase 1 Deployment

Production app URL:

```text
https://toolsforunderstanding.com/delulu-spectrum/
```

## Recommended Cloudflare Pages setup

1. Create a Pages project from this repo.
2. Set the build command to blank.
3. Set the output directory to `deploy`.
4. Add the custom domain `toolsforunderstanding.com`.
5. Cloudflare will give you the required DNS records. Apply them where the domain's DNS is hosted, or move DNS to Cloudflare and let it create the records.

## Netlify setup

This repo includes `netlify.toml`, so Netlify should detect:

- Publish directory: `deploy`
- Build command: blank
- Root redirect: `/` -> `/delulu-spectrum/`
- Trailing-slash redirect: `/delulu-spectrum` -> `/delulu-spectrum/`

After deploy, add `toolsforunderstanding.com` as the production custom domain in Netlify and use the DNS records Netlify provides.

## Live smoke test

Run the same loop used in Phase 0 against the production URL:

1. Open `https://toolsforunderstanding.com/delulu-spectrum/`.
2. Self-rate and create the owner link.
3. Open the rater link in a private browser window.
4. Submit 3 anonymous ratings.
5. Reload the owner link and confirm the result reveals.
6. Use share result and confirm the shared link opens.
