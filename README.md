# n8n-nodes-cellystial

This is an [n8n](https://n8n.io) community node. It lets you use
[Cellystial](https://cellystial.com) in your n8n workflows.

**Cellystial** turns dynamic JSON data into beautiful PDFs from reusable templates. This package
ships two nodes: a **Cellystial** action node that generates PDFs from your templates — one at a
time, or in bulk — and a **Cellystial Trigger** that starts workflows when Cellystial events fire.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) ·
[Trigger](#trigger) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n docs.

In short, on a self-hosted n8n instance:

1. Go to **Settings → Community nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-cellystial` as the npm package name.
4. Agree to the risks of using community nodes and select **Install**.

After installation the **Cellystial** and **Cellystial Trigger** nodes are available in the nodes panel.

## Credentials

You need a Cellystial API key.

1. Sign in to your [Cellystial dashboard](https://app.cellystial.com).
2. Create an API key under **Settings → Developer & API**. Keys start with `sk_prod_`
   (production) or `sk_test_` (testing).
3. In n8n, create a new **Cellystial API** credential and paste the key.

The credential is verified against `GET /api/v1/users/me`, so an invalid key is caught
immediately when you save it.

## Operations

### Generate PDF

Generates a single PDF from a Cellystial template and returns it as binary data.

| Parameter | Description |
| --- | --- |
| **Template** | The template to render. The dropdown is populated automatically from your account. |
| **JSON Payload** | The JSON data injected into the template schema (e.g. `{ "amount": 100, "customer": "Cellystial" }`). |
| **File Name** | Optional name for the generated PDF binary (defaults to `document.pdf`). |
| **Put Output File in Field** | The output binary field name (defaults to `data`). |

The output PDF is ready to pass to nodes like **Write Binary File**, **Send Email**, or any HTTP
upload. When the node receives multiple items, it generates one PDF per item. Each output item
carries your **input JSON** through unchanged plus `success: true` (the PDF rides along as binary);
with **Continue On Fail** enabled, a failed item carries an `error` message instead.

### Generate PDFs (Batch)

Queues a bulk batch of PDFs from many data rows in a single asynchronous request — ideal for
generating documents from a spreadsheet on a schedule. **Each incoming item becomes one row.**

| Parameter | Description |
| --- | --- |
| **Template** | The template to render for every row in the batch. |
| **Row Data** | The data for one PDF. Defaults to the whole incoming item (`{{ $json }}`); map specific fields if needed. |
| **Document ID** | Optional. Your own unique ID for the row (e.g. `{{ $json.invoice_no }}`), echoed back in the results and used as the PDF filename — so you can map each output PDF to its source. Set it on every row to use this mode, or leave it blank on all rows to map by position. |
| **Output Filename** | Optional. The PDF filename for the row. Defaults to the Document ID. |
| **Completion Webhook URL** | Optional. A URL Cellystial calls when the batch finishes. |

This operation returns a single item with the **batch ID** and **status** (`queued`).
Generation runs asynchronously; the finished PDFs are stored and returned as **download URLs**
via **Get Batch Status** (or pushed to your **Completion Webhook URL** when the batch finishes).
If your account has **Storage** enabled the PDFs are saved permanently; if not, they're delivered
to a **temporary location that auto-expires after 7 days** and also bundled into a single **ZIP**.
Batch size is limited by your subscription plan.

### Get Batch Status

Looks up a batch by its ID. While it's still running, returns a status summary
(`total` / `completed` / `failed`). Once rows are done it emits **one item per row**, each with
that row's `rowIndex`, `documentId` (when you set one), `filename`, `status`, and `downloadUrl`
(plus a `zipUrl` for the whole batch) — so you can map every PDF back to its source row and
process them individually.

| Parameter | Description |
| --- | --- |
| **Batch ID** | The ID returned by **Generate PDFs (Batch)**. |

A typical bulk flow: **Generate PDFs (Batch)** → **Wait** → **Get Batch Status** → handle each
row's `downloadUrl` (or grab the single `zipUrl`).

## Trigger

### Cellystial Trigger

Starts a workflow the moment a Cellystial event fires — so you can react to PDFs and batches as
they complete instead of polling. On activation the node registers a webhook subscription with
Cellystial; on deactivation it removes it.

| Setting | Description |
| --- | --- |
| **Credential** | A **Cellystial API** credential (the same key the action node uses). |
| **Events** | One or more events to listen for: **PDF Generated** (`pdf.generated`), **Batch Completed** (`batch.completed`), and **Template Created / Updated / Deleted** (`template.*`). |

Each delivery starts the workflow with the event payload as JSON.

**Security.** Deliveries are signed with a per-subscription secret and sent in an
`X-Cellystial-Signature` header (`t=<unix>,v1=<hmac-sha256>`). The trigger **verifies every
request** against the exact received bytes and rejects forged, tampered, or replayed payloads with
`401` — they never start your workflow. The signing secret is captured automatically when the node
registers, so there's nothing to configure.

## Compatibility

- Requires n8n with Node.js 20 or newer.
- Tested against n8n nodes API version 1.

## Resources

- [Cellystial documentation](https://cellystial.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
