/**
 * Pure, read-only Easypaisa Pakistan money transfer interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope from Easypaisa.
 * @param {string} transactionId The explicitly selected transaction ID.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretEasypaisa(input, transactionId) {
  const CURRENCY = "PKR";
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
  if (!root) return fail("Expected response object");

  const account = object(root.account);

  /** @type {unknown[] | null} */
  let txList = null;
  if (Array.isArray(root.transactions)) {
    txList = root.transactions;
  } else if (root.id === transactionId || root.trxId === transactionId) {
    txList = [root];
  }

  if (!txList) {
    return fail("Expected transactions array or matching transaction payload");
  }

  const rows = txList.filter((r) => {
    const obj = object(r);
    return obj?.id === transactionId || obj?.trxId === transactionId;
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.type ?? row.transactionType;
  if (
    rawType !== "moneyTransfer" &&
    rawType !== "easypaisaTransfer" &&
    rawType !== "p2p" &&
    rawType !== "transfer"
  ) {
    return {
      outcome: "unsupported",
      reason: "Only outgoing PKR money transfers are supported",
    };
  }

  if (row.direction !== "debit" && row.direction !== "outgoing") {
    return {
      outcome: "unsupported",
      reason: "Only outgoing debit transfers are supported",
    };
  }

  const completedStatuses = ["COMPLETED", "SUCCESS", "SUCCESSFUL"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only PKR is supported");
  }

  const amountStr = typeof row.amount === "string" ? row.amount.trim() : null;
  const amountMatch = amountStr ? /^(0|[1-9]\d{0,14})(?:\.(\d+))?$/.exec(amountStr) : null;
  const fraction = amountMatch?.[2] ?? "";
  if (!amountMatch || fraction.length > EXPONENT) {
    return fail("Amount must be a decimal string within currency precision");
  }
  const minor = BigInt(amountMatch[1]) * 100n + BigInt(fraction.padEnd(EXPONENT, "0"));
  if (minor <= 0n) return fail("Amount must be positive");

  if (
    typeof row.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(row.timestamp)
  ) {
    return fail("Expected an explicit UTC timestamp");
  }
  const timeMs = Date.parse(row.timestamp);
  if (
    !Number.isFinite(timeMs) ||
    new Date(timeMs).toISOString().slice(0, 19) !== row.timestamp.slice(0, 19)
  ) {
    return fail("Invalid timestamp calendar date");
  }

  /**
   * Normalize Pakistan mobile number to E.164 (+92...) format.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizePkPhone = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\+923\d{8,10}$/.test(clean)) return clean;
    if (/^923\d{8,10}$/.test(clean)) return `+${clean}`;
    if (/^03\d{8,10}$/.test(clean)) return `+92${clean.slice(1)}`;
    return null;
  };

  const payerObj = object(row.payer) ?? account;
  const payerPhone = normalizePkPhone(payerObj?.mobileNumber ?? payerObj?.msisdn);
  const payerAcc =
    typeof payerObj?.accountNumber === "string" && /^\d{10,24}$/.test(payerObj.accountNumber)
      ? payerObj.accountNumber
      : null;
  const payerId = payerPhone ?? payerAcc;
  if (!payerId) {
    return fail("Full unmasked payer mobile number or account identifier is required");
  }
  const payerScheme = payerPhone ? "pk-msisdn" : "pk-account-number";
  const payerProvenance = payerPhone ? "payer.mobileNumber" : "payer.accountNumber";

  const payeeObj = object(row.payee) ?? object(row.counterparty);
  const payeePhone = normalizePkPhone(payeeObj?.mobileNumber ?? payeeObj?.msisdn);
  const payeeAcc =
    typeof payeeObj?.accountNumber === "string" && /^\d{10,24}$/.test(payeeObj.accountNumber)
      ? payeeObj.accountNumber
      : null;
  const payeeId = payeePhone ?? payeeAcc;
  if (!payeeId) {
    return fail("Full unmasked payee mobile number or account identifier is required");
  }
  const payeeScheme = payeePhone ? "pk-msisdn" : "pk-account-number";
  const payeeProvenance = payeePhone ? "payee.mobileNumber" : "payee.accountNumber";

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "pk/easypaisa",
      transactionId,
      payer: {
        id: payerId,
        scheme: payerScheme,
        provenance: payerProvenance,
      },
      payee: {
        id: payeeId,
        scheme: payeeScheme,
        provenance: payeeProvenance,
      },
      amountMinor: minor.toString(),
      currency: CURRENCY,
      currencyExponent: EXPONENT,
      direction: "outgoing",
      status: row.status,
      timestamp: row.timestamp,
      timestampMeaning: "completionTime",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the sender-wallet status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are mobile numbers or account references, not verified legal persons.",
        "Transaction ID is local to Easypaisa network; no cross-bank deduplication is claimed.",
      ],
    },
  };
}
