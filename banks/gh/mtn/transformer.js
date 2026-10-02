/**
 * Pure, read-only MTN MoMo Ghana interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt the bank page or app loaded.
 * @param {string} transactionId The explicitly selected transaction identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretMtn(input, transactionId) {
  const CURRENCY = "GHS";
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

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  if (row.type !== "domesticTransfer" && row.type !== "momoTransfer") {
    return { outcome: "unsupported", reason: "Only domestic transfers are supported" };
  }
  if (row.direction !== "debit") {
    return { outcome: "unsupported", reason: "Only outgoing debit transfers are supported" };
  }

  if (
    row.status === "PENDING" ||
    row.status === "pending" ||
    row.status === "PROCESSING" ||
    row.status === "SUBMITTED"
  ) {
    return fail("Transaction is still pending bank execution");
  }
  const completedStatuses = ["COMPLETED", "completed", "SUCCESS", "SUCCESSFUL"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only GHS is supported");
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
    .replace(/^(?:GHS|GH₵|GH¢)\s*/i, "")
    .replace(/\s*(?:GHS|GH₵|GH¢)$/i, "")
    .trim();

  let whole = "";
  let fraction = "";

  if (rawAmount.includes(".") && rawAmount.includes(",")) {
    const dotIdx = rawAmount.indexOf(".");
    const commaIdx = rawAmount.indexOf(",");
    if (dotIdx < commaIdx) {
      whole = rawAmount.slice(0, commaIdx).replaceAll(".", "");
      fraction = rawAmount.slice(commaIdx + 1);
    } else {
      whole = rawAmount.slice(0, dotIdx).replaceAll(",", "");
      fraction = rawAmount.slice(dotIdx + 1);
    }
  } else if (rawAmount.includes(",")) {
    const parts = rawAmount.split(",");
    if (parts.length === 2 && parts[1].length <= EXPONENT) {
      whole = parts[0];
      fraction = parts[1];
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
    typeof payer?.phone === "string"
      ? payer.phone
      : typeof payer?.msisdn === "string"
        ? payer.msisdn
        : typeof payer?.accountNumber === "string"
          ? payer.accountNumber
          : typeof payer?.id === "string"
            ? payer.id
            : "";
  if (!text(rawPayerId) || /[*•?]/.test(rawPayerId)) {
    return fail("Unmasked payer mobile identifier is required");
  }
  const payerClean = rawPayerId.replace(/[\s-]/g, "").replace(/^\+/, "");
  const isPayerMsisdn = /^(?:0[235]\d{8}|233[235]\d{8})$/.test(payerClean);
  if (!isPayerMsisdn) {
    return fail("Valid Ghana MSISDN mobile identifier is required for payer");
  }

  const payee = object(row.payee) ?? object(row.counterparty);
  const rawPayeeId =
    typeof payee?.phone === "string"
      ? payee.phone
      : typeof payee?.msisdn === "string"
        ? payee.msisdn
        : typeof payee?.accountNumber === "string"
          ? payee.accountNumber
          : typeof payee?.id === "string"
            ? payee.id
            : "";
  if (!text(rawPayeeId) || /[*•?]/.test(rawPayeeId)) {
    return fail("Unmasked counterparty mobile identifier is required");
  }
  const payeeClean = rawPayeeId.replace(/[\s-]/g, "").replace(/^\+/, "");
  const isPayeeMsisdn = /^(?:0[235]\d{8}|233[235]\d{8})$/.test(payeeClean);
  if (!isPayeeMsisdn) {
    return fail("Valid Ghana MSISDN mobile identifier is required for payee");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "gh/mtn",
      transactionId,
      payer: {
        id: payerClean,
        scheme: "gh-msisdn",
        provenance: "account.phone",
      },
      payee: {
        id: payeeClean,
        scheme: "gh-msisdn",
        provenance: "transaction.payee.phone",
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
        "Completed is the sender reported status, not proof of recipient credit or irreversible settlement.",
        "Payer identity is a mobile money wallet reference, not a verified legal person.",
        "Transaction ID is local to MTN MoMo Ghana; no cross service deduplication is claimed.",
        "Merchant payments, agent cash out, airtime topups, and cross border remittances are unsupported.",
      ],
    },
  };
}
