# Environment schema deployment lab

This app builds without deployment credentials or a `.env` file. Its annotated `.env.example` declares config, validation, and generated types. Examples never supply defaults. The page renders public config only; `/api/config` reports synthetic private test values and a secret digest for verification. Keep that diagnostic route confined to this lab.

From the repository root, install dependencies and build with synthetic deployment variables absent:

```sh
pnpm install
env -u NUXT_API_SECRET -u NUXT_ACCOUNT_PIN -u NUXT_RETRIES \
  -u NUXT_OPTIONAL_LIMIT -u NUXT_PUBLIC_REPLAY_ENABLED \
  -u NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE -u NUXT_PUBLIC_LOG_LEVEL \
  -u NUXT_PUBLIC_API_BASE -u NUXT_PUBLIC_DISPLAY_LABEL \
  pnpm --filter nuxt-safe-runtime-config-lab-env-schema build
```

Start the built artifact with synthetic values. `ACCOUNT_PIN` remains the string `1e3`, while retries, flags, and sampling rates become numbers and booleans:

```sh
NUXT_API_SECRET=synthetic-lab-secret-one NUXT_ACCOUNT_PIN=1e3 \
  NUXT_RETRIES=3 NUXT_OPTIONAL_LIMIT= \
  NUXT_PUBLIC_REPLAY_ENABLED=true NUXT_PUBLIC_TELEMETRY_SAMPLE_RATE=0.4 \
  HOST=127.0.0.1 PORT=3187 node labs/env-schema/.output/server/index.mjs
```

Open `http://127.0.0.1:3187` and `http://127.0.0.1:3187/api/config`. Stop the server, change injected values, then run the same command without rebuilding. Missing required values, invalid ranges/enums/URLs, and an explicitly empty display label fail runtime validation.

Run the automated production checks with one worker:

```sh
pnpm test:lab:env-schema
```

The test prepares generated types, checks the actual consumer, builds once, restarts that artifact, checks rendered HTML and client assets, and exercises startup failures. It removes inherited `NUXT_*`, `NITRO_*`, `HOST`, and `PORT` settings from child processes. No deployment secrets or external services are needed.

The final check rebuilds with an inherited synthetic credential, verifies that no output file contains it, and starts that artifact with a different runtime credential. CI runs this lab separately from the main suite to avoid overlapping framework builds.
