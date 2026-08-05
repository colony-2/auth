# Cloudflare Deployment Runbook

This runbook deploys the authentication Worker, management API, authorization gateway, protected sample API, and React console into isolated `staging` or `production` environments.

## Prerequisites

1. Create one D1 database and one R2 bucket per environment:

   ```bash
   npx wrangler d1 create authz-control-plane-staging
   npx wrangler r2 bucket create authz-policy-staging
   npx wrangler d1 create authz-control-plane-production
   npx wrangler r2 bucket create authz-policy-production
   ```

2. Replace the D1 IDs and example hostnames in `wrangler.authn.jsonc`, `wrangler.management.jsonc`, and `wrangler.demo-authz.jsonc`.

3. Export deployment credentials. `deploy/.env.example` lists the required variables; load them through the shell or CI secret store. Do not commit populated environment files.

4. Generate an asymmetric signing key and public JWKS. Keep the private JWK only in Cloudflare secrets. During rotation, publish both old and new public keys in `JWT_PUBLIC_JWKS` until all old access tokens have expired.

## Secrets

Set secrets independently for each environment:

```bash
npx wrangler secret put JWT_PRIVATE_JWK --config wrangler.authn.jsonc --env staging
npx wrangler secret put JWT_PUBLIC_JWKS --config wrangler.authn.jsonc --env staging
npx wrangler secret put INTERNAL_AUTH_TOKEN --config wrangler.authn.jsonc --env staging
npx wrangler secret put IP_HASH_SECRET --config wrangler.authn.jsonc --env staging
npx wrangler secret put MANAGEMENT_API_TOKEN --config wrangler.authn.jsonc --env staging
npx wrangler secret put OIDC_PROVIDERS_JSON --config wrangler.authn.jsonc --env staging

npx wrangler secret put MANAGEMENT_BOOTSTRAP_TOKEN --config wrangler.management.jsonc --env staging
npx wrangler secret put AUTHZ_ADMIN_TOKEN --config wrangler.management.jsonc --env staging
npx wrangler secret put SCIM_BEARER_TOKEN --config wrangler.management.jsonc --env staging
npx wrangler secret put ADMIN_TOKEN --config wrangler.demo-authz.jsonc --env staging
```

Use a short-lived bootstrap token and replace direct bootstrap access with gateway-issued administrator identity before production use. `BOOTSTRAP_ENABLED` is intentionally absent from deployed authn environments.

## Validate And Deploy

Validate every bundle without remote changes:

```bash
npm run deploy:cloudflare:dry-run -- --env staging
```

Deploy in dependency order and apply D1 migrations:

```bash
npm run deploy:cloudflare -- --env staging
```

The orchestrator deploys the sample upstream, authentication Worker, gateway, management API, and management UI. It requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `VITE_MANAGEMENT_API_BASE_URL`. Use `--skip-migrations` only when migrations were applied separately by a controlled release job.

Seed staging using `npm run demo:seed` with the deployed URLs supplied to an environment-specific seed job, or use the management API and OpenAPI client to create production vocabulary and scopes. The local demo bootstrap route is not available in deployed authn environments.

## Smoke Tests

Set the URLs from `deploy/.env.example`, then run:

```bash
npm run smoke:cloudflare
```

The suite always checks authn health, JWKS, management health, the management OpenAPI document, and the UI. With `SMOKE_USERNAME` and `SMOKE_PASSWORD`, it also mints a real JWT and verifies one allowed and one denied gateway request.

Staging smoke tests must pass before production deployment. CI should use a dedicated viewer account with no mutation permissions.

## Rollback

Published R2 artifacts are immutable. Rollback creates a new version from a previously recorded artifact and moves the manifest forward; it never edits historical objects.

```bash
npm run rollback:config -- \
  --management-url https://authz-management-service-staging.example.workers.dev \
  --token "$MANAGEMENT_TOKEN" \
  --service projects-api \
  --scope proj-alpha \
  --version demo-proj-alpha-previous
```

Omit `--scope` to roll back a service-global version. Run smoke tests immediately afterward. Database schema migrations require a separately reviewed forward migration; D1 migrations are not automatically reversed.

## Production Controls

- Protect management and gateway admin routes with the authorization gateway and Cloudflare Access or equivalent administrator SSO.
- Scope API tokens to the target account and required Workers, D1, and R2 resources.
- Keep staging and production D1 databases, R2 buckets, custom domains, signing keys, and credentials separate.
- Export Worker logs and audit events without bearer tokens, refresh tokens, private keys, or provisioning secrets.
- Alert on JWKS failures, management publish failures, repeated authentication failures, D1 errors, and elevated gateway `5xx` rates.
