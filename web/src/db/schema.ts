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
  ],
);

export type CommandStatus = "pending" | "sent" | "succeeded" | "failed" | "timeout";
export type CommandPurpose = "baseline" | "verify" | "poll" | "manual";

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
    type: text("type", { enum: ["ussd_balance"] }).notNull(),
    ussdCode: text("ussd_code").notNull(),
    purpose: text("purpose").$type<CommandPurpose>().notNull(),
    txId: uuid("tx_id"),
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
  feeMillimes: millimes("fee_millimes").notNull().default(0),
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

export const WALLET_ENTRY_KINDS = ["sale", "withdrawal", "withdrawal_refund", "adjustment"] as const;
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
    // Taken from the balance (gross), fee of the method at request time, amount actually sent (net).
    grossMillimes: millimes("gross_millimes").notNull(),
    feeMillimes: millimes("fee_millimes").notNull(),
    netMillimes: millimes("net_millimes").notNull(),
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
