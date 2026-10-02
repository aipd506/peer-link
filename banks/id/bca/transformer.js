/**
 * Pure, read-only Bank Central Asia (BCA) interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt the bank page/app loaded.
 * @param {string} transactionId The explicitly selected transaction ID.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretBca(input, transactionId) {
  const CURRENCY = "IDR";
  const EXPONENT = 0;

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

  if (
    row.status === "DIPROSES" ||
    row.status === "pending" ||
    row.status === "PENDING" ||
    row.status === "IN_PROGRESS"
  ) {
    return fail("Transaction is still pending bank execution");
  }
  const completedStatuses = ["BERHASIL", "SUCCESS", "COMPLETED"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only IDR is supported");
  }

  // Parse amount: support Indonesian formatting (period thousands separator, optional "Rp"/"IDR" prefix, whole units)
  let rawAmount = "";
  if (typeof row.amount === "number") {
    if (!Number.isFinite(row.amount) || row.amount <= 0 || !Number.isInteger(row.amount)) {
      return fail("Amount must be a whole decimal string within currency precision");
    }
    rawAmount = row.amount.toString();
  } else if (typeof row.amount === "string") {
    rawAmount = row.amount.trim();
  } else {
    return fail("Amount must be a whole decimal string within currency precision");
  }

  // Strip currency prefixes: "Rp", "Rp.", "IDR"
  rawAmount = rawAmount
    .replace(/^(?:IDR|Rp\.?)\s*/i, "")
    .replace(/\s*(?:IDR|Rp\.?)$/i, "")
    .trim();

  // Strip zero fractional cents if present: e.g. ",00", ".00", ",0", ".0"
  if (/[.,]0{1,2}$/.test(rawAmount)) {
    rawAmount = rawAmount.replace(/[.,]0{1,2}$/, "");
  }

  // Handle thousand separators: "500.000" or "1.500.000"
  let whole = "";
  if (rawAmount.includes(".")) {
    const parts = rawAmount.split(".");
    if (
      parts.length >= 2 &&
      parts.every((p, idx) => (idx === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}$/.test(p)))
    ) {
      whole = parts.join("");
    } else {
      return fail("Amount must be a whole decimal string within currency precision");
    }
  } else {
    whole = rawAmount;
  }

  if (!/^(0|[1-9]\d{0,14})$/.test(whole)) {
    return fail("Amount must be a whole decimal string within currency precision");
  }

  const minor = BigInt(whole);
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
    typeof payer?.accountNumber === "string"
      ? payer.accountNumber
      : typeof payer?.id === "string"
        ? payer.id
        : "";
  if (!text(rawPayerId) || /[*•?]/.test(rawPayerId)) {
    return fail("Unmasked payer account identifier is required");
  }
  const payerId = rawPayerId.replace(/[\s-]/g, "");
  const isPayerBcaAcc = /^\d{10}$/.test(payerId);

  const payee = object(row.payee);
  const rawPayeeId =
    typeof payee?.accountNumber === "string"
      ? payee.accountNumber
      : typeof payee?.id === "string"
        ? payee.id
        : "";
  if (!text(rawPayeeId) || /[*•?]/.test(rawPayeeId)) {
    return fail("Unmasked counterparty account identifier is required");
  }
  const payeeId = rawPayeeId.replace(/[\s-]/g, "");
  const isPayeeBcaAcc = /^\d{10}$/.test(payeeId);

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "id/bca",
      transactionId,
      payer: {
        id: isPayerBcaAcc ? payerId : rawPayerId.trim(),
        scheme: isPayerBcaAcc ? "bca-account-number" : "bca-account-id",
        provenance: "account.id",
      },
      payee: {
        id: isPayeeBcaAcc ? payeeId : rawPayeeId.trim(),
        scheme: isPayeeBcaAcc ? "bca-account-number" : "id-recipient-id",
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
        "Completed is the sender-bank status, not proof of recipient credit or irreversible settlement.",
        "Payer identity is a bank account reference, not a verified legal person.",
        "Transaction ID is local to BCA; no cross-bank deduplication is claimed.",
        "BI-FAST transfers depend on Bank Indonesia settlement infrastructure availability.",
      ],
    },
  };
}
