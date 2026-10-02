/**
 * Pure, read-only BBVA Mexico SPEI transfer interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope from BBVA Mexico.
 * @param {string} transactionId The explicitly selected transaction or tracking key.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretBbvaMexico(input, transactionId) {
  const CURRENCY = "MXN";
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
  } else if (root.id === transactionId || root.claveRastreo === transactionId) {
    txList = [root];
  }

  if (!txList) {
    return fail("Expected transactions array or matching transaction payload");
  }

  const rows = txList.filter((r) => {
    const obj = object(r);
    return obj?.id === transactionId || obj?.claveRastreo === transactionId;
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  if (row.type !== "spei" && row.type !== "speiTransfer") {
    return {
      outcome: "unsupported",
      reason: "Only outgoing MXN SPEI transfers are supported",
    };
  }

  if (row.direction !== "debit" && row.direction !== "outgoing") {
    return {
      outcome: "unsupported",
      reason: "Only outgoing debit transfers are supported",
    };
  }

  const completedStatuses = ["COMPLETED", "EXITOSO", "LIQUIDADO"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only MXN is supported");
  }

  if (typeof row.claveRastreo !== "string" || !/^[A-Za-z0-9]{7,30}$/.test(row.claveRastreo)) {
    return fail("Valid SPEI clave de rastreo tracking key is required");
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

  const payerObj = object(row.payer) ?? account;
  const payerClabe =
    typeof payerObj?.clabe === "string" && /^\d{18}$/.test(payerObj.clabe) ? payerObj.clabe : null;
  const payerAccount =
    typeof payerObj?.accountNumber === "string" && /^\d{10,16}$/.test(payerObj.accountNumber)
      ? payerObj.accountNumber
      : null;
  const payerId = payerClabe ?? payerAccount;
  if (!payerId) {
    return fail("Full unmasked payer account identifier or CLABE is required");
  }
  const payerScheme = payerClabe ? "mx-clabe" : "bbva-account-number";
  const payerProvenance = payerClabe ? "payer.clabe" : "payer.accountNumber";

  const payeeObj = object(row.payee) ?? object(row.counterparty);
  const payeeClabe =
    typeof payeeObj?.clabe === "string" && /^\d{18}$/.test(payeeObj.clabe) ? payeeObj.clabe : null;
  const payeeAccount =
    typeof payeeObj?.accountNumber === "string" && /^\d{10,18}$/.test(payeeObj.accountNumber)
      ? payeeObj.accountNumber
      : null;
  const payeeId = payeeClabe ?? payeeAccount;
  if (!payeeId) {
    return fail("Full unmasked payee account identifier or CLABE is required");
  }
  const payeeScheme = payeeClabe ? "mx-clabe" : "mx-bank-account";
  const payeeProvenance = payeeClabe ? "payee.clabe" : "payee.accountNumber";

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "mx/bbva-mexico",
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
      timestampMeaning: "operationTime",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the sender-bank status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are bank account or CLABE identifiers, not verified legal persons.",
        `Clave de rastreo is validated as an interbank SPEI tracking key: ${row.claveRastreo}`,
        "Transaction ID is local to this bank or SPEI network; no cross-bank deduplication is claimed.",
      ],
    },
  };
}
