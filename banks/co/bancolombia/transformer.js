/**
 * Pure, read-only Bancolombia interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt the bank page loaded.
 * @param {string} transactionId The explicitly selected transaction identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretBancolombia(input, transactionId) {
  const CURRENCY = "COP";
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
  } else if (Array.isArray(root?.movements)) {
    txList = root.movements;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (root?.id === transactionId || root?.reference === transactionId) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.movement) ?? object(root?.data);
    if (wrapped?.id === transactionId || wrapped?.reference === transactionId) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected account and transactions");
  }

  const rows = txList.filter(
    (r) => object(r)?.id === transactionId || object(r)?.reference === transactionId,
  );
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const validTypes = ["domesticTransfer", "bancolombiaTransfer", "transferencia"];
  if (typeof row.type === "string" && !validTypes.includes(row.type)) {
    return { outcome: "unsupported", reason: "Only domestic transfers are supported" };
  }
  if (row.direction === "credit" || row.direction === "incoming") {
    return { outcome: "unsupported", reason: "Only outgoing debit transfers are supported" };
  }

  const pendingStatuses = ["PENDING", "pending", "EN_PROCESO", "PROGRAMADA", "EN_TRAMITE"];
  if (typeof row.status === "string" && pendingStatuses.includes(row.status)) {
    return fail("Transaction is still pending bank execution");
  }
  const completedStatuses = [
    "COMPLETED",
    "completed",
    "EXITOSA",
    "exitosa",
    "SUCCESS",
    "APROBADA",
    "aprobada",
  ];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only COP is supported");
  }

  let rawAmount = "";
  if (typeof row.amount === "number") {
    if (!Number.isFinite(row.amount) || row.amount <= 0 || !Number.isInteger(row.amount)) {
      return fail("Amount must be a positive integer representing COP whole pesos");
    }
    rawAmount = row.amount.toString();
  } else if (typeof row.amount === "string") {
    rawAmount = row.amount.trim();
  } else {
    return fail("Amount must be an integer string within currency precision");
  }

  rawAmount = rawAmount
    .replace(/^(?:COP|\$)\s*/i, "")
    .replace(/\s*(?:COP|\$)$/i, "")
    .trim();

  if (rawAmount.endsWith(",00")) {
    rawAmount = rawAmount.slice(0, -3);
  } else if (rawAmount.endsWith(".00")) {
    rawAmount = rawAmount.slice(0, -3);
  }

  if (/^\d{1,3}(\.\d{3})+$/.test(rawAmount)) {
    rawAmount = rawAmount.replaceAll(".", "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(rawAmount)) {
    rawAmount = rawAmount.replaceAll(",", "");
  }

  if (!/^(0|[1-9]\d{0,14})$/.test(rawAmount)) {
    return fail("Amount must be an integer string within currency precision");
  }

  const minor = BigInt(rawAmount);
  if (minor <= 0n) return fail("Amount must be positive");

  const timestampField =
    typeof row.bookedAt === "string"
      ? "bookedAt"
      : typeof row.timestamp === "string"
        ? "timestamp"
        : "date";
  const rawTime =
    typeof row[timestampField] === "string" ? /** @type {string} */ (row[timestampField]) : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(rawTime)) {
    return fail("Expected an explicit UTC ISO 8601 timestamp ending with Z");
  }
  const timeMs = Date.parse(rawTime);
  if (
    !Number.isFinite(timeMs) ||
    new Date(timeMs).toISOString().slice(0, 19) !== rawTime.slice(0, 19)
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
  const payerClean = rawPayerId.replace(/[\s-]/g, "");
  if (!/^\d{11}$/.test(payerClean)) {
    return fail("Valid 11-digit Bancolombia account number is required for payer");
  }

  const payee = object(row.payee) ?? object(row.counterparty);
  const rawPayeeId =
    typeof payee?.accountNumber === "string"
      ? payee.accountNumber
      : typeof payee?.id === "string"
        ? payee.id
        : "";
  if (!text(rawPayeeId) || /[*•?]/.test(rawPayeeId)) {
    return fail("Unmasked counterparty account identifier is required");
  }
  const payeeClean = rawPayeeId.replace(/[\s-]/g, "");
  if (!/^\d{11}$/.test(payeeClean)) {
    return fail("Valid 11-digit Bancolombia account number is required for payee");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "co/bancolombia",
      transactionId,
      payer: {
        id: payerClean,
        scheme: "bancolombia-account-number",
        provenance: object(row.payer) ? "transaction.payer.accountNumber" : "account.accountNumber",
      },
      payee: {
        id: payeeClean,
        scheme: "bancolombia-account-number",
        provenance: object(row.payee)
          ? "transaction.payee.accountNumber"
          : "transaction.counterparty.accountNumber",
      },
      amountMinor: minor.toString(),
      currency: CURRENCY,
      currencyExponent: EXPONENT,
      direction: "outgoing",
      status: row.status,
      timestamp: rawTime,
      timestampMeaning: timestampField,
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the sender reported status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are local Bancolombia account numbers, not verified legal persons.",
        "Transaction ID is local to Bancolombia; no cross service deduplication is claimed.",
        "Transfiya fast payments, interbank ACH, and international wires stay unsupported.",
      ],
    },
  };
}
