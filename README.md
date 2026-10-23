<img src="assets/icon.svg" width="64" height="64" alt="">

# Sarfli — phone credit → cash

Sellers send phone credit (Ooredoo, Orange, Tunisie Telecom) to one of your SIMs. Each confirmed transfer adds
`amount × daily rate` to the seller's **account balance**; the seller withdraws the balance whenever they want
(in full or in part) by D17, Flouci or postal money order. Every transfer is confirmed **twice**: by the
operator's SMS *and* by the SIM balance read over USSD.

The brand name lives in one place: `web/src/config/brand.ts` (and `android-agent/app/src/main/res/values/strings.xml`).

```
rechargemarketplace/
├── web/             Next.js 16 app: seller site, admin console, device API, worker (PostgreSQL)
├── android-agent/   Android app that runs on each SIM phone (reads SMS, runs balance USSD)
└── docker-compose.yml   PostgreSQL
```

## How a sale works

1. The seller picks operator, amount and sender number. The **rate is locked** and the amount that will be added
   to their balance is shown before starting.
2. A free SIM of that operator is reserved **only for this sale**. Before showing the number, the phone reads the
   SIM balance (*baseline*). If that fails, the sale goes back to the queue — a number is never shown without it.
   If all numbers are busy the seller waits in a queue and sees their position.
3. The seller has 15 minutes to send the credit with the operator code shown (`*120*…#`, `*116*…#`, `*133*…#`).
4. The operator SMS (`Vous avez recu 1000 Millimes de la part du numéro 2xxxxxxx`) arrives on the phone → the server
   checks the sender is the seller's number → the phone re-reads the balance. Credit counts **only when
   `new balance − baseline` equals the SMS amounts**.
5. Outcomes:
   - full amount (or more) → confirmed at the amount actually received;
   - less → seller chooses *send the rest* or *accept what was received*; at expiry the received amount is settled;
   - nothing → expired; a later transfer from the same sender is linked as a *late credit* for the admin;
   - SMS without balance change (fake SMS), balance change without SMS, SIM swapped, USSD failing → **review queue**.
     The number stays reserved until the admin decides.
6. The cash value at the locked rate is **added to the seller's balance** (no fee at this point).

## Balance & withdrawals

- The balance is an append-only ledger (`wallet_entries`): sale credits, withdrawals, refunds and manual adjustments.
- On **My balance** the seller requests a withdrawal: any amount up to the balance (minimum set in Admin → Settings),
  choosing the method and details each time. The method fee (e.g. mandate 5 DT) is charged **once per withdrawal**.
  The amount leaves the balance immediately; several requests can be pending at once; sellers cannot cancel a request.
- Staff (Admin → Withdrawals) **mark it paid** (reference, note, proof) or **reject** it with a reason, which refunds the
  full amount to the balance.
- Staff can **adjust** any balance (bonus / correction) with a mandatory note shown in the seller's statement
  (Admin → Sellers & balances).

## Roles

| Role | Can |
|---|---|
| `seller` | Sell, see balance, request withdrawals |
| `manager` | Everything in *Operations*: review queue, withdrawals, sales, unmatched credits, sellers & balance adjustments |
| `admin` | Managers' rights + *Setup* (numbers & phones, operators & rates, settings) + assigning roles and blocking users |

The e-mails in `ADMIN_EMAILS` become admins when they sign in (bootstrap). After that, admins manage roles in
Admin → Sellers & balances. An admin cannot change their own role or block themselves.

Other safety rails: one active sale per sender number, a cooldown before a number is reused, balance polling while a
number is held, a per-SIM balance ledger flagging any unexplained change, and an audit timeline on every sale.

## Run it with Docker (production)

Requirements: Docker. Everything runs in containers: PostgreSQL, the web app, the worker and a one-shot
migration/seed job.

```bash
cp .env.example .env          # set POSTGRES_PASSWORD (before the first start!), AUTH_SECRET, AUTH_URL, Google keys, ADMIN_EMAILS
docker compose up -d --build  # http://<this-machine>:3100
docker compose ps             # web should be "healthy", migrate "Exited (0)"
docker compose logs -f web worker
```

| Service | Role |
|---|---|
| `db` | PostgreSQL 17, data in the `pgdata` volume, reachable only from this machine on `127.0.0.1:5433` |
| `migrate` | Applies migrations + default operators/payout methods on every `up`, then exits. Upgrading from the per-sale payout version: confirmed sales whose payout was still pending are converted into balance credits (gross amount); paid ones stay as history under Withdrawals → *Old per-sale payouts* |
| `web` | Seller site, admin console and the API the phones call (port `WEB_PORT`, default 3100) |
| `worker` | Expiries, USSD timeouts, balance polling, queue assignment — run exactly one |
| `cloudflared` | Optional (`--profile tunnel`): publishes the site on your domain over HTTPS |

- Updating: `git pull && docker compose up -d --build` (migrations run automatically).
- Payment proofs live in the `storage` volume. Back up both volumes, e.g.
  `docker compose exec db pg_dump -U rasseed rasseed > backup.sql`.
- **Sellers must reach the site from the internet, and Google sign-in requires a real domain (or localhost).**
  The simplest way from a local server is a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):
  create a tunnel pointing to `http://web:3100`, put its token in `TUNNEL_TOKEN`, set `AUTH_URL` to your domain and run
  `docker compose --profile tunnel up -d`.
- The phones talk to the server over the LAN (`http://<server-ip>:3100`) or the public URL.
- Put the server, router and phones on a UPS.

## Run it (development)

Requirements: Node 22+, pnpm, Docker.

```bash
docker compose up -d db              # PostgreSQL only, on localhost:5433
cd web
cp .env.example .env                 # then edit it (see below)
pnpm install
pnpm db:migrate && pnpm db:seed      # tables + 3 operators + D17 / Flouci / mandate (5 DT fee)
pnpm dev                             # http://localhost:3100
pnpm worker                          # second terminal: expiries, timeouts, balance polling
```

Sign in with an e-mail listed in `ADMIN_EMAILS` to get the admin console at `/admin` (managers get the operations pages only).
For local testing set `AUTH_DEV_LOGIN=true` to get a password-less login form (never in production).

### Try it without phones

```bash
# Admin → Numbers & phones → Add phone → copy the 6-digit code, then:
pnpm sim:phone <code> http://localhost:3100
```
Configure its two SIMs in the admin, start a sale on the site, then type in the simulator:
`send 0 5000 <sender>` (real transfer), `fakesms 0 5000 <sender>`, `silent 0 5000`, `balance`.

### Tests

```bash
pnpm test        # parsers & money (unit)
pnpm test:e2e    # 14 end-to-end scenarios (sales, balance, withdrawals) against the running server + worker
```

## Environment (`web/.env` for development; `.env` at the root for Docker)

| Variable | |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_URL` | Public URL of the site (Google redirects here) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console → OAuth client (Web). Redirect URI: `<AUTH_URL>/api/auth/callback/google` |
| `ADMIN_EMAILS` | Comma-separated admin e-mails |
| `AUTH_DEV_LOGIN` | `true` only for local testing |
| `STORAGE_DIR` | Where payment proofs are stored (back it up) |

## The agent phones

Build: `cd android-agent && ./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
(copy it to `web/public/downloads/sarfli-agent.apk` before `docker compose up --build` so phones can download it from `http://<server>:3100/downloads/sarfli-agent.apk`).
The release APK is signed with the debug key for side-loading — use your own keystore for wider distribution.

Per phone (Android 7.1+ / SDK 25+, dual-SIM supported — both SIMs join the pool).
On Android 7.x the Accessibility step is required: balance checks can only be read from the dialer popup there.
It is also needed when the balance isn't on the first USSD page (Orange `*101#` sometimes): if the operator's
balance regex doesn't match yet and the menu shows `01:Page suivante`, the agent types `01`, sends it, and
reports all pages joined together (up to 4 pages).

**Quick setup from a Windows PC:** plug the phone in with USB debugging on and run `android-agent\setup-device.bat`.
It installs the APK, grants permissions, enables the balance reader, disables battery optimisation, checks the SIM is
registered, and on Sunmi terminals turns the phone & SMS function back on (`is_open_phone_sms`, without it every call/USSD
is cancelled). Re-run it if a Sunmi terminal stops dialling after a reboot.
1. Install the APK, open it, tap **Grant permissions** (SMS, phone) and **Allow running in background**.
   On Xiaomi/Huawei/Oppo also enable *Autostart* and set battery to *No restrictions* for the app.
2. Admin → Numbers & phones → **Add phone** → type the server URL and the 6-digit code in the app.
3. The SIMs appear in the admin: set operator + number for each and activate. A balance check runs immediately.
4. Keep the phone charging, on Wi-Fi, screen lock without PIN delays is fine. Disable the phone's own SMS
   auto-deletion.

The app keeps every SMS and USSD reply in a local queue until the server confirms it, restarts on boot, and also
scans the inbox for any SMS the broadcast missed. All parsing happens on the server, so formats can be changed in
**Admin → Operators & rates** (with a tester) without touching the phones.

## Configuration to verify with real samples

These are editable in **Admin → Operators & rates** and must be checked with real messages before going live:

- **Balance USSD reply format** for `*100#`, `*101#`, `*122#` — the default regex looks for `<number> DT|dinars|millimes`.
  The page lists the latest raw replies from your phones; use the tester.
- **Credit SMS** — the default regex matches `Vous avez recu 1000 Millimes de la part du numéro 23249201` for all three
  operators. Add each operator's SMS sender name to *Trusted SMS senders* to reject SMS sent from personal numbers.
- **Transfer codes shown to sellers** — Ooredoo `*120*{number}#` (amount entered in the menu),
  Orange `*116*{number}*{millimes}#`, TT `*133*{millimes}*{number}#`.
- **Rates** start at 80% as a placeholder.
- **Minimum withdrawal** starts at 5 DT as a placeholder (Admin → Settings).
