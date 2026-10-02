/**
 * Pure, read-only GCash interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt the bank page/app loaded.
 * @param {string} transactionId The explicitly selected transaction ID.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretGcash(input, transactionId) {
  const CURRENCY = "PHP";
  const EXPONENT = 2;

  const fail = (/** @type {string} */ reason) =>
    /** @type {const} */ ({ outcome: "insufficient_evidence", reason });
  const object = (/** @type {unknown} */ v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? /** @type {Record<string, unknown>} */ (v)
      : null;
  const text = (/** @type {unknown} */ v) => typeof v === "string" && v.trim().length > 0;

  if (!text(transactionId)) return fail("A transaction ID is required");

  const root = object(input);
  const account = object(root?.account);

  let txList = null;
  if (Array.isArray(input)) {
    txList = input;
  } else if (Array.isArray(root?.transactions)) {
    txList = root.transactions;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (root?.id === transactionId) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.data);
    if (wrapped?.id === transactionId) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected account and transactions");
  }

  const rows = txList.filter((r) => object(r)?.id === transactionId);
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = object(rows[0]);
  if (!row) return fail("Invalid transaction");

  if (row.type !== "domesticTransfer") {
    return { outcome: "unsupported", reason: "Only domestic transfers are supported" };
  }
  if (row.direction !== "debit") {
    return { outcome: "unsupported", reason: "Only outgoing debit transfers are supported" };
  }

  if (row.status === "PENDING" || row.status === "pending" || row.status === "PROCESSING") {
    return fail("Transaction is still pending bank execution");
  }
  const completedStatuses = ["COMPLETED", "SUCCESS", "PAID"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only PHP is supported");
  }

  // Parse amount: support Philippine formatting (optional ₱ / PHP prefix, comma thousands separators, decimal units)
  let rawAmount = "";
  if (typeof row.amount === "number") {
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      return fail("Amount must be a positive number");
    }
    rawAmount = row.amount.toString();
  } else if (typeof row.amount === "string") {
    rawAmount = row.amount.trim();
  } else {
    return fail("Amount must be a decimal string within currency precision");
  }

  // Strip currency prefixes: "₱", "PHP"
  rawAmount = rawAmount
    .replace(/^(?:PHP|₱)\s*/i, "")
    .replace(/\s*(?:PHP|₱)$/i, "")
    .trim();

  // Strip comma thousand separators
  if (rawAmount.includes(",")) {
    const parts = rawAmount.split(",");
    if (
      parts.length >= 2 &&
      parts.every((p, idx) => (idx === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}(?:\.\d+)?$/.test(p)))
    ) {
      rawAmount = rawAmount.replaceAll(",", "");
    } else {
      return fail("Amount must be a decimal string within currency precision");
    }
  }

  const amountMatch = /^(0|[1-9]\d{0,14})(?:\.(\d+))?$/.exec(rawAmount);
  const fraction = amountMatch?.[2] ?? "";
  if (!amountMatch || fraction.length > EXPONENT) {
    return fail("Amount must be a decimal string within currency precision");
  }

  const minor =
    BigInt(amountMatch[1]) * 10n ** BigInt(EXPONENT) +
    BigInt(fraction.padEnd(EXPONENT, "0") || "0");
  if (minor <= 0n) return fail("Amount must be positive");

  if (
    typeof row.bookedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(row.bookedAt)
  ) {
    return fail("Expected an explicit UTC ISO 8601 timestamp ending with Z");
  }
  const timeMs = Date.parse(row.bookedAt);
  if (
    !Number.isFinite(timeMs) ||
    new Date(timeMs).toISOString().slice(0, 19) !== row.bookedAt.slice(0, 19)
  ) {
    return fail("Invalid timestamp calendar date");
  }

  const payer = object(row.payer) ?? account;
  const rawPayerId =
    typeof payer?.mobileNumber === "string"
      ? payer.mobileNumber
      : typeof payer?.id === "string"
        ? payer.id
        : "";
  if (!text(rawPayerId) || /[*•?]/.test(rawPayerId)) {
    return fail("Unmasked payer mobile number or account identifier is required");
  }
  const payerId = rawPayerId.replace(/[\s-]/g, "");
  const isPayerMobile = /^09\d{9}$|^\+639\d{9}$|^639\d{9}$/.test(payerId);

  const payee = object(row.payee);
  const rawPayeeId =
    typeof payee?.mobileNumber === "string"
      ? payee.mobileNumber
      : typeof payee?.accountNumber === "string"
        ? payee.accountNumber
        : typeof payee?.id === "string"
          ? payee.id
          : "";
  if (!text(rawPayeeId) || /[*•?]/.test(rawPayeeId)) {
    return fail("Unmasked counterparty mobile number or identifier is required");
  }
  const payeeId = rawPayeeId.replace(/[\s-]/g, "");
  const isPayeeMobile = /^09\d{9}$|^\+639\d{9}$|^639\d{9}$/.test(payeeId);

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "ph/gcash",
      transactionId,
      payer: {
        id: isPayerMobile ? payerId : rawPayerId.trim(),
        scheme: isPayerMobile ? "ph-mobile-number" : "gcash-account-id",
        provenance: "account.id",
      },
      payee: {
        id: isPayeeMobile ? payeeId : rawPayeeId.trim(),
        scheme: isPayeeMobile ? "ph-mobile-number" : "ph-recipient-id",
        provenance: "transaction.payee",
      },
      amountMinor: minor.toString(),
      currency: CURRENCY,
      currencyExponent: EXPONENT,
      direction: "outgoing",
      status: row.status,
      timestamp: row.bookedAt,
      timestampMeaning: "bookedAt",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the sender-bank/wallet status, not proof of recipient credit or irreversible settlement.",
        "Payer identity is a mobile wallet account reference, not a verified legal person.",
        "Transaction ID is local to GCash; no cross-bank deduplication is claimed.",
        "InstaPay transfers depend on Bangko Sentral ng Pilipinas (BSP) automated clearing house participant availability.",
      ],
    },
  };
}
