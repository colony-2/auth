# Project Workspace Demo

This sample is the executable reference integration for the authentication service, management service, authorization gateway, and protected upstream API.

Run the complete local stack:

```bash
npm run demo:up
```

The command applies local D1 migrations, generates an ephemeral ES256 key, starts all Workers and the React console, seeds and publishes the project-workspace model, then prints the service URLs.
It also writes ignored `.dev.vars.authn`, `.dev.vars.management`, and `.dev.vars.gateway` files containing local-only credentials.

Run the self-contained behavior suite:

```bash
npm run demo:test
```

Useful commands while `demo:up` is running:

```bash
npm run demo:seed
npm run demo:token -- --user alice --aud projects-api
npm run demo:request -- --user alice --method GET --path /projects/proj-alpha --scope proj-alpha
```

Demo credentials use the pattern `<username>-password`. The local management console accepts `local-management-token`. These values are local-only and must not be used in deployed environments.
