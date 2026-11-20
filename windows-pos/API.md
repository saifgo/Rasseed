# Sarfli POS API (v1)

The Windows POS app spends a buyer's balance on recharges and data packages. Buying credit from sellers stays on the web.

Base URL: `https://sarfli.com/api/pos/v1`, configurable in the app for testing, for example `http://localhost:3100/api/pos/v1`.
Bodies are JSON (`Content-Type: application/json`). Money amounts are integers in **millimes** (1 DT = 1000 millimes). Dates are ISO-8601 UTC strings.

## Pairing

1. On the web, the buyer opens **Buy → POS terminals**, names a terminal and gets a 6-digit code that is valid for 10 minutes.
2. The POS sends the code:

```
POST /pair            (no auth)
{ "code": "123456", "deviceName": "PC-SHOP-1" }
→ 200 { "token": "pos_...", "terminal": { "id": "...", "name": "Shop counter" } }
→ 409 { "error": "invalid_code" }
```

3. The buyer can revoke a terminal on the same web page at any time. The POS's own "Unpair" only forgets the token locally.
4. The POS stores the token (DPAPI-protected, current user) and sends `Authorization: Bearer <token>` on every other call. A `401 { "error": "unauthorized" }` means the terminal was revoked or the buyer lost access. The app then goes back to the pairing screen.

## Endpoints

### `GET /me`
```json
{
  "terminal": { "id": "…", "name": "Shop counter", "dailyLimitMillimes": 100000, "spentTodayMillimes": 35000 },
  "user": { "name": "Ali", "email": "ali@example.com" },
  "source": "sarfli",
  "operators": [
    { "code": "ooredoo", "name": "Ooredoo", "color": "#e30613",
      "balanceMillimes": 12000, "dataBalanceMillimes": 12000, "rechargeEnabled": true, "maxRechargeMillimes": 20000 }
  ],
  "packages": [
    { "id": "uuid", "operatorCode": "ooredoo", "name": "Pass 1 Go - 7 days", "priceMillimes": 5000 }
  ]
}
```
`source` says whose credit this terminal spends:
- `"sarfli"`: the terminal belongs to an **admin**. Recharges and packages are paid from Sarfli's own credit, and this works even when the marketplace is off. `balanceMillimes` per operator is what Sarfli can spend now: the real credit on Sarfli's phones (last balance readings), minus credit from unconfirmed sales, unmatched credits, credit owned by marketplace users, and recharges still in progress.
- `"balance"`: a marketplace buyer spending his own balance.

`balanceMillimes` is what can be spent on Light recharges, `dataBalanceMillimes` on Internet packages. For a buyer both are his balance. For Sarfli each is also capped by the credit on the SIMs allowed to send that kind (each SIM is set to accept credit, send credit and/or send data in Admin → Numbers). Both are only for greying out what cannot be paid. The app never shows them to the cashier.

Limits (the server enforces both on `POST /recharges`; the app uses them to grey out what would be refused):
- `maxRechargeMillimes`: an admin setting (Admin → Settings → SarfliPOS recharge limit), the largest plain (Light) recharge one POS sale can send for that operator. `null` = no cap. Packages and recharges from the website are not capped.
- `terminal.dailyLimitMillimes`: set by the owner on sarfli.com (Buy → Shop PCs), the most this PC can spend per day, recharges and packages together. `null` = no limit. `spentTodayMillimes` counts this PC's recharges since midnight Tunisia time that are queued, sending, succeeded or in review (failed and cancelled ones were refunded and do not count).

`rechargeEnabled = false` means plain recharges for that operator are not available: not configured yet, or no SIM of that operator is allowed to send credit. Packages may still exist. Only active packages are listed, and only for operators with a SIM allowed to send data.

### `POST /recharges`
A plain recharge:
```json
{ "operatorCode": "ooredoo", "msisdn": "22123456", "amountMillimes": 5000, "clientRef": "c3f1…" }
```
A data package (the operator and amount come from the package):
```json
{ "packageId": "uuid", "msisdn": "22123456", "clientRef": "c3f1…" }
```
`clientRef` is **required**. Use a new GUID per sale the cashier confirms, and reuse it when retrying the same request after a network error. The server returns the existing recharge for a `clientRef` it already saw, so a retry never charges twice.

`msisdn` accepts 8 digits, `+216…` or `00216…`.

→ `200 { "recharge": Recharge }`
→ `409 { "error": code }` with code one of `insufficient_credit`, `invalid_msisdn`, `invalid_amount`, `operator_unavailable`, `recharge_unavailable`, `package_unavailable`, `marketplace_closed`, `sarfli_credit_insufficient` (admin terminal: Sarfli's spendable credit on that operator is too low), `pos_recharge_limit` (plain recharge above the operator's `maxRechargeMillimes`), `pos_daily_limit` (this sale would take the PC over its daily limit).

### `GET /recharges?limit=50`
→ `200 { "recharges": Recharge[] }`, newest first, at most 200.

### `GET /recharges/{id}`
→ `200 { "recharge": Recharge }` or `404 { "error": "not_found" }`.

### `POST /recharges/{id}/cancel`
Allowed only while `status = "queued"`. The amount goes back to the balance.
→ `200 { "recharge": Recharge }` or `409 { "error": "cannot_cancel" }`.

### Recharge object
```json
{
  "id": "uuid", "ref": "RC-ABC234", "operatorCode": "ooredoo", "msisdn": "22123456",
  "amountMillimes": 5000, "packageName": null, "status": "queued", "failReason": null,
  "createdAt": "2026-11-14T10:00:00Z", "completedAt": null
}
```
Statuses:

| Status | Meaning |
| --- | --- |
| `queued` | Waiting for a free phone. Can be cancelled. |
| `sending` | A phone is sending it. |
| `succeeded` | Sent. The amount was deducted. |
| `failed` | Not sent. The amount was returned. |
| `cancelled` | Cancelled by the buyer before it was sent. The amount was returned. |
| `review` | Unclear result. An admin decides. |

`failReason` is set only on some `failed` recharges: `"number_not_compatible"` means the operator does not offer this package to that number (the agent phone checked the USSD menu before buying). Otherwise `null`.

`queued` and `sending` are live, so the app polls `GET /recharges/{id}` every 3–5 s until the status changes.

## Errors
Every error is `{ "error": "<code>" }`: 400 `bad_request`, 401 `unauthorized`, 404 `not_found`, 409 business errors (above), 429 `rate_limited`, 500 `server_error`.
