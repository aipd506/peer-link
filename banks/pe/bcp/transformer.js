/**
 * Pure, read-only Banco de Credito del Peru (BCP) interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt the bank page loaded.
 * @param {string} transactionId The explicitly selected transaction identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretBcp(input, transactionId) {
  const CURRENCY = "PEN";
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
  } else if (Array.isArray(root?.movements)) {
    txList = root.movements;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (
    root?.id === transactionId ||
    root?.operationNumber === transactionId ||
    root?.reference === transactionId
  ) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.movement) ?? object(root?.data);
    if (
      wrapped?.id === transactionId ||
      wrapped?.operationNumber === transactionId ||
      wrapped?.reference === transactionId
    ) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected account and transactions");
  }

  const rows = txList.filter(
    (r) =>
      object(r)?.id === transactionId ||
      object(r)?.operationNumber === transactionId ||
      object(r)?.reference === transactionId,
  );
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  if (row.type === "yapeTransfer" || row.paymentMethod === "yape") {
    return { outcome: "unsupported", reason: "Yape payments are unsupported" };
  }

  const validTypes = ["domesticTransfer", "bcpTransfer", "transferencia", "interbankTransfer"];
  if (typeof row.type === "string" && !validTypes.includes(row.type)) {
    return { outcome: "unsupported", reason: "Only domestic transfers are supported" };
  }
  if (row.direction === "credit" || row.direction === "incoming") {
    return { outcome: "unsupported", reason: "Only outgoing debit transfers are supported" };
  }

  const pendingStatuses = ["PENDING", "pending", "EN_PROCESO", "PROGRAMADA", "EN_CURSO"];
  if (typeof row.status === "string" && pendingStatuses.includes(row.status)) {
    return fail("Transaction is still pending bank execution");
  }
  const completedStatuses = [
    "COMPLETED",
    "completed",
    "REALIZADA",
    "realizada",
    "SUCCESS",
    "EXITOSA",
    "exitosa",
  ];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not bank-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only PEN is supported");
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
    .replace(/^(?:PEN|S\/\.?)\s*/i, "")
    .replace(/\s*(?:PEN|S\/\.?)$/i, "")
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

  if (/^\d{1,3}([\s\u00A0\u202F]\d{3})+$/.test(whole)) {
    whole = whole.replace(/[\s\u00A0\u202F]/g, "");
  }

  if (!/^(0|[1-9]\d{0,14})$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > EXPONENT) {
    return fail("Amount must be a decimal string within currency precision");
  }

  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(EXPONENT, "0"));
  if (minor <= 0n) return fail("Amount must be positive");

  const timestampField =
    typeof row.bookedAt === "string"
      ? "bookedAt"
      : typeof row.timestamp === "string"
        ? "timestamp"
        : typeof row.operationDate === "string"
          ? "operationDate"
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
      : typeof payer?.cci === "string"
        ? payer.cci
        : typeof payer?.id === "string"
          ? payer.id
          : "";
  if (!text(rawPayerId) || /[*•?]/.test(rawPayerId)) {
    return fail("Unmasked payer account identifier is required");
  }
  const payerClean = rawPayerId.replace(/[\s-]/g, "");
  let payerScheme = "";
  if (/^\d{14}$/.test(payerClean)) {
    payerScheme = "bcp-account-number";
  } else if (/^\d{20}$/.test(payerClean)) {
    payerScheme = "pe-cci";
  } else {
    return fail("Valid 14-digit BCP account number or 20-digit CCI is required for payer");
  }

  const payee = object(row.payee) ?? object(row.counterparty);
  const rawPayeeId =
    typeof payee?.accountNumber === "string"
      ? payee.accountNumber
      : typeof payee?.cci === "string"
        ? payee.cci
        : typeof payee?.id === "string"
          ? payee.id
          : "";
  if (!text(rawPayeeId) || /[*•?]/.test(rawPayeeId)) {
    return fail("Unmasked counterparty account identifier is required");
  }
  const payeeClean = rawPayeeId.replace(/[\s-]/g, "");
  let payeeScheme = "";
  if (/^\d{14}$/.test(payeeClean)) {
    payeeScheme = "bcp-account-number";
  } else if (/^\d{20}$/.test(payeeClean)) {
    payeeScheme = "pe-cci";
  } else {
    return fail("Valid 14-digit BCP account number or 20-digit CCI is required for payee");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "pe/bcp",
      transactionId,
      payer: {
        id: payerClean,
        scheme: payerScheme,
        provenance: object(row.payer) ? "transaction.payer.accountNumber" : "account.accountNumber",
      },
      payee: {
        id: payeeClean,
        scheme: payeeScheme,
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
        "Payer and payee identities are local BCP account numbers or CCIs, not verified legal persons.",
        "Transaction ID is local to BCP; no cross service deduplication is claimed.",
        "Yape mobile payments, international wires, and bill payments stay unsupported.",
      ],
    },
  };
}
