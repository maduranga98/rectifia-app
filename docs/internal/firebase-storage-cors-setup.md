# Firebase Storage CORS setup (policy document uploads)

`uploadPolicy()` (`src/services/policyService.js`) does not proxy file bytes
through a Cloud Function. It asks `requestPolicyUploadUrl` for a V4 signed
URL (`functions/src/policy/policyStorage.js:createUploadUrl`), then the
browser itself does `fetch(uploadUrl, { method: 'PUT', ... })` straight
against `storage.googleapis.com`. That is a cross-origin request from
`https://app.rectifia.com`, so the browser sends a CORS preflight (`OPTIONS`)
before the `PUT`. Google Cloud Storage buckets have **no CORS
configuration by default**, so the preflight has no
`Access-Control-Allow-Origin` header to check against and the browser blocks
the upload with:

```
Access to fetch at 'https://storage.googleapis.com/...' from origin
'https://app.rectifia.com' has been blocked by CORS policy: Response to
preflight request doesn't pass access control check: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

This is a bucket-level setting, not something `firebase deploy` or any code
change in this repo can set - it has to be applied once (and again whenever
the allowed origins change) with `gcloud`/`gsutil` against the actual
bucket, by someone with Storage Admin on the project.

Downloads (`createDownloadUrl`) do **not** need this: the app never
`fetch()`s a download URL from JS - `PolicyReferences.jsx` /
`PoliciesPage.jsx` navigate the browser to it directly (see the comment on
`createDownloadUrl`), which is a simple top-level navigation, not a CORS
request.

## The config

[`infra/storage/cors.json`](../../infra/storage/cors.json) is the source of
truth for the bucket's CORS policy:

```json
[
  {
    "origin": ["https://app.rectifia.com", "http://localhost:5173"],
    "method": ["GET", "PUT", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

- `PUT` is what the upload itself uses; `GET`/`HEAD` are included so a
  future browser-side read of a signed URL (or a CORS-sensitive SDK call)
  isn't blocked by the same gap.
- `responseHeader: ["Content-Type"]` matches the `Content-Type` signed into
  the upload URL (`createUploadUrl` binds it into the signature; the client
  sends it as a header on the `PUT`).
- Add any additional web origin (a staging domain, another local dev port)
  to the `origin` array before applying, rather than widening it with a
  wildcard - the signed URL is already a narrow, expiring credential; the
  bucket-level CORS origin allowlist is the only thing standing between it
  and an arbitrary third-party site running the same `fetch()` if a URL ever
  leaked.

## Applying it

Requires `gcloud` authenticated as a principal with
`roles/storage.admin` (or equivalent) on the `rectifia-59a1e` project:

```sh
gcloud storage buckets update gs://rectifia-59a1e.firebasestorage.app \
  --cors-file=infra/storage/cors.json
```

(`gsutil cors set infra/storage/cors.json gs://rectifia-59a1e.firebasestorage.app`
works identically if `gsutil` is what's installed.)

Verify it took effect:

```sh
gcloud storage buckets describe gs://rectifia-59a1e.firebasestorage.app --format="default(cors)"
```

No redeploy of hosting or functions is needed - the policy lives on the
bucket itself and takes effect immediately.
