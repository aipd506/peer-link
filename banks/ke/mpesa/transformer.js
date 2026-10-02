/**
 * Pure, read-only Safaricom M-Pesa transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt from Safaricom M-Pesa.
 * @param {string} transactionId The explicitly selected transaction or receipt ID.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretMpesa(input, transactionId) {
  const CURRENCY = "KES";
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
  } else if (Array.isArray(root?.items)) {
    txList = root.items;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (root?.id === transactionId || root?.receiptNumber === transactionId) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (wrapped?.id === transactionId || wrapped?.receiptNumber === transactionId) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected transactions array or matching receipt payload");
  }

  const rows = txList.filter((r) => {
    const obj = object(r);
    return obj?.id === transactionId || obj?.receiptNumber === transactionId;
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.type ?? row.transactionType;
  if (
    rawType !== "sendMoney" &&
    rawType !== "send_money" &&
    rawType !== "Send Money" &&
    rawType !== "p2p" &&
    rawType !== "P2P" &&
    rawType !== "transfer"
  ) {
    return {
      outcome: "unsupported",
      reason: "Only outgoing KES Send Money transfers are supported",
    };
  }

  if (
    row.paybill ||
    row.tillNumber ||
    row.businessNumber ||
    row.fuliza ||
    row.fulizaAmount ||
    row.isPaybill ||
    row.isBuyGoods
  ) {
    return {
      outcome: "unsupported",
      reason: "Lipa na M-Pesa (Buy Goods / Paybill) and Fuliza transactions are excluded",
    };
  }

  if (row.direction !== "debit" && row.direction !== "outgoing") {
    return { outcome: "unsupported", reason: "Only outgoing debit transfers are supported" };
  }

  if (row.status === "PENDING" || row.status === "PROCESSING") {
    return fail("Transaction is still pending execution");
  }
  if (row.status === "FAILED" || row.status === "CANCELLED" || row.status === "REVERSED") {
    return fail("Transaction failed or was reversed");
  }
  const completedStatuses = ["COMPLETED", "SUCCESS", "SUCCESSFUL"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not network-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only KES is supported");
  }

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

  rawAmount = rawAmount
    .replace(/^(?:KES|Ksh)\s*/i, "")
    .replace(/\s*(?:KES|Ksh)$/i, "")
    .trim();

  let whole = "";
  let fraction = "";

  if (rawAmount.includes(",")) {
    const parts = rawAmount.split(",");
    const last = parts[parts.length - 1];
    if (last.includes(".")) {
      whole = parts.join("").split(".")[0];
      fraction = last.split(".")[1];
    } else {
      return fail("Amount must be a decimal string within currency precision");
    }
  } else if (rawAmount.includes(".")) {
    const parts = rawAmount.split(".");
    if (parts.length === 2 && parts[1].length <= EXPONENT) {
      whole = parts[0];
      fraction = parts[1];
    } else {
      return fail("Amount must be a decimal string within currency precision");
    }
  } else {
    whole = rawAmount;
    fraction = "";
  }

  if (!/^(0|[1-9]\d{0,14})$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > EXPONENT) {
    return fail("Amount must be a decimal string within currency precision");
  }

  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(EXPONENT, "0"));
  if (minor <= 0n) return fail("Amount must be positive");

  const rawTime = row.completedAt ?? row.timestamp;
  if (
    typeof rawTime !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(rawTime)
  ) {
    return fail("Expected an explicit UTC ISO 8601 timestamp ending with Z");
  }
  const timeMs = Date.parse(rawTime);
  if (
    !Number.isFinite(timeMs) ||
    new Date(timeMs).toISOString().slice(0, 19) !== rawTime.slice(0, 19)
  ) {
    return fail("Invalid timestamp calendar date");
  }

  /**
   * Normalize Kenyan mobile number to E.164 (+254...) format.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeKePhone = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\+254\d{9}$/.test(clean)) return clean;
    if (/^254\d{9}$/.test(clean)) return `+${clean}`;
    if (/^0\d{9}$/.test(clean)) return `+254${clean.slice(1)}`;
    return null;
  };

  const payer = object(row.payer) ?? account;
  const payerMsisdn = normalizeKePhone(payer?.phone ?? payer?.msisdn ?? payer?.id);
  if (!payerMsisdn) {
    return fail("Valid unmasked payer Kenyan phone number is required");
  }

  const payee = object(row.payee);
  const payeeMsisdn = normalizeKePhone(payee?.phone ?? payee?.msisdn ?? payee?.id);
  if (!payeeMsisdn) {
    return fail("Valid unmasked destination Kenyan phone number is required");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "ke/mpesa",
      transactionId,
      payer: {
        id: payerMsisdn,
        scheme: "ke-msisdn",
        provenance: "account.phone",
      },
      payee: {
        id: payeeMsisdn,
        scheme: "ke-msisdn",
        provenance: "transaction.payee",
      },
      amountMinor: minor.toString(),
      currency: CURRENCY,
      currencyExponent: EXPONENT,
      direction: "outgoing",
      status: row.status,
      timestamp: rawTime,
      timestampMeaning: "completedAt",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the network-reported status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are mobile phone numbers, not verified legal persons.",
        "Transaction receipt number is local to Safaricom M-Pesa; no cross-network deduplication is claimed.",
        "Send Money transfers are subject to Safaricom M-Pesa account limits and Kenyan regulatory terms.",
      ],
    },
  };
}
