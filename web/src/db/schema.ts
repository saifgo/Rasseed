import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// All money is stored as integer millimes (1 TND = 1000 millimes).
// Rates are stored in basis points (1 TND of credit pays rateBps / 10000 TND).
const millimes = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------------------
// Auth.js tables
// ---------------------------------------------------------------------------

export const USER_ROLES = ["seller", "manager", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
/** Admins and managers can use the console. */
export const STAFF_ROLES: UserRole[] = ["admin", "manager"];

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: ts("email_verified"),
  image: text("image"),
  role: text("role", { enum: ["seller", "manager", "admin"] }).notNull().default("seller"),
  blocked: boolean("blocked").notNull().default(false),
  // Buyer marketplace is opened to a few trusted users first (admin ticks this per user).
  marketplaceAccess: boolean("marketplace_access").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires").notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Operators & rates
// ---------------------------------------------------------------------------

export const operators = pgTable("operators", {
  code: text("code").primaryKey(), // ooredoo | orange | tt
  name: text("name").notNull(),
  color: text("color").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  rateBps: integer("rate_bps").notNull(),
  // Shown to the seller. Placeholders: {number} {millimes} {dinars}
  transferUssdTemplate: text("transfer_ussd_template").notNull(),
  balanceUssdCode: text("balance_ussd_code").notNull(),
  // Regex with named groups `amount` and `sender` applied to incoming SMS bodies.
  creditSmsRegex: text("credit_sms_regex").notNull(),
  // Unit of the `amount` group in the credit SMS: millimes | dinars
  creditSmsUnit: text("credit_sms_unit", { enum: ["millimes", "dinars"] }).notNull().default("millimes"),
  // Optional allow-list of SMS originating addresses (e.g. operator short codes). Empty = accept any.
  creditSmsSenders: jsonb("credit_sms_senders").$type<string[]>().notNull().default([]),
  // Regex with named group `amount` (and optional `unit`) applied to the balance USSD reply.
  balanceRegex: text("balance_regex").notNull(),
  balanceUnit: text("balance_unit", { enum: ["auto", "millimes", "dinars"] }).notNull().default("auto"),
  // USSD our agent phones dial to send credit to a customer (buyer recharges). Placeholders: {number} {millimes} {dinars}.
  // Empty = recharges for this operator are off until the real operator dialog is configured.
  rechargeUssdTemplate: text("recharge_ussd_template"),
  // Replies typed into the following USSD menu pages, in order (same placeholders), e.g. ["{millimes}", "1"].
  rechargeUssdSteps: jsonb("recharge_ussd_steps").$type<string[]>().notNull().default([]),
  // Largest plain ("Light") recharge one POS sale may send, in millimes. Null = no cap. Packages are not capped.
  posMaxRechargeMillimes: integer("pos_max_recharge_millimes"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rateHistory = pgTable("rate_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorCode: text("operator_code")
    .notNull()
    .references(() => operators.code),
  rateBps: integer("rate_bps").notNull(),
  setBy: text("set_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Devices (Android agent phones) & SIM cards
// ---------------------------------------------------------------------------

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").unique(),
  pairingCode: text("pairing_code"),
  pairingExpiresAt: ts("pairing_expires_at"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: ts("last_seen_at"),
  lastIp: text("last_ip"),
  batteryPct: integer("battery_pct"),
  charging: boolean("charging"),
  model: text("model"),
  androidVersion: text("android_version"),
  appVersion: text("app_version"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type SimStatus = "unconfigured" | "active" | "disabled";

export const sims = pgTable(
  "sims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    subscriptionId: integer("subscription_id").notNull(),
    carrierName: text("carrier_name"),
    operatorCode: text("operator_code").references(() => operators.code),
    msisdn: text("msisdn"), // 8-digit local number
    status: text("status").$type<SimStatus>().notNull().default("unconfigured"),
    balanceMillimes: millimes("balance_millimes"),
    balanceCheckedAt: ts("balance_checked_at"),
    heldByTxId: uuid("held_by_tx_id"),
    // Set while this SIM sends a buyer recharge; the SIM takes no sale meanwhile.
    heldByRechargeId: uuid("held_by_recharge_id"),
    cooldownUntil: ts("cooldown_until"),
    lastAssignedAt: ts("last_assigned_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastReportedAt: ts("last_reported_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sims_device_slot_idx").on(t.deviceId, t.slotIndex),
    uniqueIndex("sims_msisdn_idx").on(t.msisdn),
    uniqueIndex("sims_held_by_idx").on(t.heldByTxId),
    uniqueIndex("sims_held_by_recharge_idx").on(t.heldByRechargeId),
  ],
);

export type CommandStatus = "pending" | "sent" | "succeeded" | "failed" | "timeout";
export type CommandPurpose =
  | "baseline"
  | "verify"
  | "poll"
  | "manual"
  // Buyer recharges: balance before, the send itself, balance after.
  | "recharge_baseline"
  | "recharge_send"
  | "recharge_verify";

export const deviceCommands = pgTable(
  "device_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["ussd_balance", "ussd_send"] }).notNull(),
    ussdCode: text("ussd_code").notNull(),
    // ussd_send only: replies to type into the following menu pages.
    steps: jsonb("steps").$type<string[]>().notNull().default([]),
    purpose: text("purpose").$type<CommandPurpose>().notNull(),
    txId: uuid("tx_id"),
    rechargeId: uuid("recharge_id"),
    status: text("status").$type<CommandStatus>().notNull().default("pending"),
    // Not delivered to the device before this time (used for verification retries).
    notBefore: ts("not_before").notNull().defaultNow(),
    rawResponse: text("raw_response"),
    error: text("error"),
    parsedBalanceMillimes: millimes("parsed_balance_millimes"),
    createdAt: ts("created_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("device_commands_device_status_idx").on(t.deviceId, t.status)],
);

export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id, { onDelete: "cascade" }),
    balanceMillimes: millimes("balance_millimes").notNull(),
    commandId: uuid("command_id").references(() => deviceCommands.id),
    // new balance - (previous balance + credits announced in between). Non-zero = unexplained change.
    discrepancyMillimes: millimes("discrepancy_millimes"),
    takenAt: ts("taken_at").notNull().defaultNow(),
  },
  (t) => [index("balance_snapshots_sim_idx").on(t.simId, t.takenAt)],
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    simId: uuid("sim_id").references(() => sims.id, { onDelete: "set null" }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    fromAddress: text("from_address").notNull(),
    body: text("body").notNull(),
    sentAt: ts("sent_at"),
    deviceReceivedAt: ts("device_received_at"),
    classification: text("classification", { enum: ["credit", "ignored", "untrusted_sender"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sms_messages_sim_idx").on(t.simId, t.createdAt)],
);

export type CreditStatus = "matched" | "unmatched" | "late" | "applied" | "rejected";

// A credit is an incoming transfer announced by an operator SMS.
export const credits = pgTable(
  "credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id),
    smsId: uuid("sms_id").references(() => smsMessages.id),
    amountMillimes: millimes("amount_millimes").notNull(),
    senderMsisdn: text("sender_msisdn").notNull(),
    // Transaction this credit belongs to (matched) or is suspected to belong to (late).
    txId: uuid("tx_id"),
    status: text("status").$type<CreditStatus>().notNull(),
    balanceVerified: boolean("balance_verified").notNull().default(false),
    note: text("note"),
    resolvedBy: text("resolved_by").references(() => users.id),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("credits_sim_idx").on(t.simId, t.receivedAt), index("credits_tx_idx").on(t.txId)],
);

// ---------------------------------------------------------------------------
// Payout methods
// ---------------------------------------------------------------------------

export type LocalizedText = { en: string; fr: string; ar: string };
export type PayoutField = { key: string; label: LocalizedText; type: "text" | "phone"; required: boolean };

export const payoutMethods = pgTable("payout_methods", {
  code: text("code").primaryKey(),
  name: jsonb("name").$type<LocalizedText>().notNull(),
  // A method charges either a fixed fee (feeMillimes) or a percentage of the amount withdrawn (feeBps), never both.
  feeMillimes: millimes("fee_millimes").notNull().default(0),
  feeBps: integer("fee_bps").notNull().default(0),
  fields: jsonb("fields").$type<PayoutField[]>().notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const savedPayoutDetails = pgTable(
  "saved_payout_details",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    methodCode: text("method_code")
      .notNull()
      .references(() => payoutMethods.code),
    details: jsonb("details").$type<Record<string, string>>().notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.methodCode] })],
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const TX_STATUSES = [
  "queued", // waiting for a free number
  "assigning", // number reserved, taking baseline balance
  "awaiting_transfer", // seller must send credit
  "verifying", // SMS received, confirming with balance check
  "partial", // part of the amount confirmed, seller chooses
  "review", // needs admin decision
  "confirmed", // credit confirmed and added to the seller's balance
  "paid", // legacy: per-sale payout sent (before the account balance)
  "expired", // nothing received within the hold window
  "cancelled", // cancelled before any credit
  "rejected", // rejected by admin
] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const ACTIVE_TX_STATUSES: TxStatus[] = ["queued", "assigning", "awaiting_transfer", "verifying", "partial"];

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    declaredMillimes: millimes("declared_millimes").notNull(),
    senderMsisdn: text("sender_msisdn").notNull(),
    rateBps: integer("rate_bps").notNull(),
    // Legacy (before the account balance): payout chosen per sale. Null for sales credited to the balance.
    payoutMethodCode: text("payout_method_code").references(() => payoutMethods.code),
    payoutDetails: jsonb("payout_details").$type<Record<string, string>>(),
    payoutFeeMillimes: millimes("payout_fee_millimes").notNull().default(0),
    status: text("status").$type<TxStatus>().notNull(),
    // Set when the seller deposits this transfer to a buyer's order instead of selling it to Sarfli.
    orderId: uuid("order_id"),
    simId: uuid("sim_id").references(() => sims.id),
    assignedMsisdn: text("assigned_msisdn"),
    baselineBalanceMillimes: millimes("baseline_balance_millimes"),
    baselineAt: ts("baseline_at"),
    smsReceivedMillimes: millimes("sms_received_millimes").notNull().default(0),
    confirmedMillimes: millimes("confirmed_millimes").notNull().default(0),
    finalMillimes: millimes("final_millimes"),
    // Cash value of the final amount at the locked rate; this is what is credited to the seller's balance.
    payoutGrossMillimes: millimes("payout_gross_millimes"),
    // Legacy: gross minus the per-sale fee. Equal to gross for balance-credited sales.
    payoutNetMillimes: millimes("payout_net_millimes"),
    partialChoice: text("partial_choice", { enum: ["topup", "accept"] }),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    unexplainedSince: ts("unexplained_since"),
    reviewReason: text("review_reason"),
    assignAttempts: integer("assign_attempts").notNull().default(0),
    queuedAt: ts("queued_at").notNull().defaultNow(),
    assignedAt: ts("assigned_at"),
    expiresAt: ts("expires_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_idx").on(t.userId, t.createdAt),
    index("transactions_status_idx").on(t.status, t.operatorCode, t.queuedAt),
    index("transactions_order_idx").on(t.orderId),
  ],
);

export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    txId: uuid("tx_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor", { enum: ["system", "seller", "admin", "device"] }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Internal events are only shown to the admin.
    internal: boolean("internal").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("transaction_events_tx_idx").on(t.txId, t.createdAt)],
);

/** Legacy per-sale payouts (before the account balance). Kept for history; nothing new is inserted. */
export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  txId: uuid("tx_id")
    .notNull()
    .unique()
    .references(() => transactions.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  methodCode: text("method_code")
    .notNull()
    .references(() => payoutMethods.code),
  details: jsonb("details").$type<Record<string, string>>().notNull(),
  grossMillimes: millimes("gross_millimes").notNull(),
  feeMillimes: millimes("fee_millimes").notNull(),
  netMillimes: millimes("net_millimes").notNull(),
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
  reference: text("reference"),
  note: text("note"),
  proofPath: text("proof_path"),
  proofMime: text("proof_mime"),
  paidAt: ts("paid_at"),
  paidBy: text("paid_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Seller account balance (wallet) & withdrawals
// ---------------------------------------------------------------------------

// stock_sale: credit from a cancelled order or kept stock that the seller sold to Sarfli.
export const WALLET_ENTRY_KINDS = ["sale", "withdrawal", "withdrawal_refund", "adjustment", "stock_sale"] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];

// Append-only ledger. The balance of a user is the sum of their entries.
export const walletEntries = pgTable(
  "wallet_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<WalletEntryKind>().notNull(),
    // Signed: positive = money added to the balance, negative = money taken from it.
    amountMillimes: millimes("amount_millimes").notNull(),
    txId: uuid("tx_id").references(() => transactions.id),
    withdrawalId: uuid("withdrawal_id"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("wallet_entries_user_idx").on(t.userId, t.createdAt)],
);

export const WITHDRAWAL_STATUSES = ["pending", "paid", "rejected"] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    methodCode: text("method_code")
      .notNull()
      .references(() => payoutMethods.code),
    details: jsonb("details").$type<Record<string, string>>().notNull(),
    // Taken from the balance (gross), fee of the method at request time, amount the seller receives (net),
    // amount staff send (send): net for a fixed fee we pay, gross for a percentage fee the method takes on receipt.
    grossMillimes: millimes("gross_millimes").notNull(),
    feeMillimes: millimes("fee_millimes").notNull(),
    netMillimes: millimes("net_millimes").notNull(),
    sendMillimes: millimes("send_millimes").notNull(),
    status: text("status").$type<WithdrawalStatus>().notNull().default("pending"),
    reference: text("reference"),
    note: text("note"),
    rejectReason: text("reject_reason"),
    proofPath: text("proof_path"),
    proofMime: text("proof_mime"),
    paidAt: ts("paid_at"),
    paidBy: text("paid_by").references(() => users.id),
    rejectedAt: ts("rejected_at"),
    rejectedBy: text("rejected_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("withdrawals_user_idx").on(t.userId, t.createdAt), index("withdrawals_status_idx").on(t.status, t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// ---------------------------------------------------------------------------
// Buyer marketplace: credit ledger, listings, orders, reputation, recharges
// ---------------------------------------------------------------------------

/**
 * Where a piece of phone credit (on Sarfli's SIMs) belongs:
 * - order: held for an open (or just-cancelled) order
 * - seller_stock: kept by a seller, per operator, used first on his next orders
 * - buyer: a buyer's spendable balance, per operator
 * - recharge: reserved from a buyer balance while a recharge is being sent
 * - sarfli: Sarfli's own credit (sales to Sarfli, commission)
 * - external: outside Sarfli's SIMs (credit coming in from sellers, going out to customers)
 * Every movement writes entries that sum to zero, so credit is never created or lost.
 */
export const CREDIT_BUCKETS = ["order", "seller_stock", "buyer", "recharge", "sarfli", "external"] as const;
export type CreditBucket = (typeof CREDIT_BUCKETS)[number];

export const creditEntries = pgTable(
  "credit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Entries of one movement share this id and sum to zero.
    movementId: uuid("movement_id").notNull(),
    kind: text("kind").notNull(),
    bucket: text("bucket").$type<CreditBucket>().notNull(),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    // Owner for seller_stock and buyer buckets.
    userId: text("user_id").references(() => users.id),
    orderId: uuid("order_id"),
    rechargeId: uuid("recharge_id"),
    txId: uuid("tx_id"),
    // Signed millimes of credit: positive = into this bucket.
    amountMillimes: millimes("amount_millimes").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credit_entries_owner_idx").on(t.bucket, t.userId, t.operatorCode),
    index("credit_entries_order_idx").on(t.orderId),
    index("credit_entries_movement_idx").on(t.movementId),
    index("credit_entries_recharge_idx").on(t.rechargeId),
  ],
);

/** A seller's price for one operator. sellerId null = Sarfli's own listing. */
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: text("seller_id").references(() => users.id),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    // What the buyer pays for 1 TND of credit, in basis points (8000 = 0.8 TND).
    priceBps: integer("price_bps").notNull(),
    // How buyers pay this seller (D17 number, Flouci, ...). Copied onto every order.
    paymentInfo: text("payment_info").notNull().default(""),
    active: boolean("active").notNull().default(true),
    // transfers = the seller sends credit to Sarfli's phones for each order;
    // balance = a buyer resells his own balance: orders are funded from it at once.
    source: text("source", { enum: ["transfers", "balance"] }).notNull().default("transfers"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("listings_seller_operator_source_key").on(t.sellerId, t.operatorCode, t.source).nullsNotDistinct()],
);

export const ORDER_STATUSES = ["funding", "funded", "proof_uploaded", "admin_review", "released", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const OPEN_ORDER_STATUSES: OrderStatus[] = ["funding", "funded", "proof_uploaded", "admin_review"];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id),
    // Null = Sarfli's own listing.
    sellerId: text("seller_id").references(() => users.id),
    listingId: uuid("listing_id").references(() => listings.id),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    // Locked when the order is placed.
    priceBps: integer("price_bps").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    paymentInfo: text("payment_info").notNull().default(""),
    requestedMillimes: millimes("requested_millimes").notNull(),
    // Current order amount (reduced by a partial order, raised when the buyer accepts extra credit).
    amountMillimes: millimes("amount_millimes").notNull(),
    // Credit held for this order (mirror of the ledger, for display and quick checks).
    fundedMillimes: millimes("funded_millimes").notNull().default(0),
    // Received beyond the order amount, waiting for the buyer to accept or refuse it.
    excessMillimes: millimes("excess_millimes").notNull().default(0),
    status: text("status").$type<OrderStatus>().notNull(),
    // Credit that reached the buyer and Sarfli's commission, set on release.
    releasedMillimes: millimes("released_millimes"),
    commissionMillimes: millimes("commission_millimes"),
    cancelledBy: text("cancelled_by", { enum: ["buyer", "seller", "admin"] }),
    cancelReason: text("cancel_reason"),
    buyerBadMark: boolean("buyer_bad_mark").notNull().default(false),
    // Resale: the seller is a buyer reselling his balance (funded from it at once, refunded to it on cancel).
    resale: boolean("resale").notNull().default(false),
    // After a cancellation with credit already on our SIMs: amount waiting for the seller's choice, and the choice.
    leftoverMillimes: millimes("leftover_millimes").notNull().default(0),
    leftoverChoice: text("leftover_choice", { enum: ["stock", "sarfli"] }),
    disputeReason: text("dispute_reason"),
    disputedBy: text("disputed_by", { enum: ["buyer", "seller"] }),
    adminNote: text("admin_note"),
    fundedAt: ts("funded_at"),
    proofUploadedAt: ts("proof_uploaded_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_buyer_idx").on(t.buyerId, t.createdAt),
    index("orders_seller_idx").on(t.sellerId, t.status, t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
  ],
);

export const orderProofs = pgTable(
  "order_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_proofs_order_idx").on(t.orderId)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor", { enum: ["system", "buyer", "seller", "admin", "device"] }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const sellerRatings = pgTable(
  "seller_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id),
    // Null = Sarfli.
    sellerId: text("seller_id").references(() => users.id),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("seller_ratings_seller_idx").on(t.sellerId)],
);

/** Data packages buyers can activate for a customer, paid from their balance. Kept by admins. */
export const dataPackages = pgTable(
  "data_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    name: text("name").notNull(),
    // Deducted from the buyer's balance, and what the agent SIM's balance must drop by.
    priceMillimes: millimes("price_millimes").notNull(),
    // USSD dialled by the agent phone. Placeholders: {number} {millimes} {dinars}.
    ussdTemplate: text("ussd_template").notNull(),
    ussdSteps: jsonb("ussd_steps").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("data_packages_operator_idx").on(t.operatorCode, t.sortOrder)],
);

/** A buyer's Windows POS terminal, paired with a short code and then using a bearer token. */
export const posTerminals = pgTable(
  "pos_terminals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    deviceName: text("device_name"),
    tokenHash: text("token_hash").unique(),
    pairingCode: text("pairing_code"),
    pairingExpiresAt: ts("pairing_expires_at"),
    lastSeenAt: ts("last_seen_at"),
    lastIp: text("last_ip"),
    // Set by the owner: most this PC may spend per day (Tunisia time), recharges + packages. Null = no limit.
    dailyLimitMillimes: integer("daily_limit_millimes"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("pos_terminals_user_idx").on(t.userId)],
);

export const RECHARGE_STATUSES = ["queued", "sending", "succeeded", "failed", "review"] as const;
export type RechargeStatus = (typeof RECHARGE_STATUSES)[number];
export const ACTIVE_RECHARGE_STATUSES: RechargeStatus[] = ["queued", "sending"];

/** A buyer spends his balance: an agent phone sends credit to a customer number by USSD. */
export const recharges = pgTable(
  "recharges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id),
    operatorCode: text("operator_code")
      .notNull()
      .references(() => operators.code),
    msisdn: text("msisdn").notNull(),
    amountMillimes: millimes("amount_millimes").notNull(),
    // Data package (null = plain recharge). Name and USSD are copied at submit time.
    packageId: uuid("package_id").references(() => dataPackages.id),
    packageName: text("package_name"),
    ussdTemplate: text("ussd_template"),
    ussdSteps: jsonb("ussd_steps").$type<string[]>(),
    // Sent from a POS terminal; clientRef makes retries of the same sale return the same recharge.
    posTerminalId: uuid("pos_terminal_id").references(() => posTerminals.id),
    clientRef: text("client_ref"),
    // balance = paid from the buyer's credit balance; sarfli = an admin spending Sarfli's own credit (POS / web).
    funding: text("funding", { enum: ["balance", "sarfli"] }).notNull().default("balance"),
    status: text("status").$type<RechargeStatus>().notNull(),
    simId: uuid("sim_id").references(() => sims.id),
    baselineBalanceMillimes: millimes("baseline_balance_millimes"),
    baselineAt: ts("baseline_at"),
    sendCommandId: uuid("send_command_id"),
    // What the phone reported for the send (null = no answer), and its raw reply.
    sendOk: boolean("send_ok"),
    sendResponse: text("send_response"),
    sendError: text("send_error"),
    afterBalanceMillimes: millimes("after_balance_millimes"),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    reviewReason: text("review_reason"),
    resolvedBy: text("resolved_by").references(() => users.id),
    note: text("note"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("recharges_buyer_idx").on(t.buyerId, t.createdAt),
    uniqueIndex("recharges_buyer_client_ref_key").on(t.buyerId, t.clientRef),
    index("recharges_status_idx").on(t.status, t.operatorCode, t.createdAt),
  ],
);
