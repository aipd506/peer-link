/**
 * Pure, read-only OPay transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt from OPay.
 * @param {string} transactionId The explicitly selected transaction or reference ID.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretOpay(input, transactionId) {
  const CURRENCY = "NGN";
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

  const matchesId = (/** @type {Record<string, unknown> | null} */ obj) =>
    obj?.id === transactionId ||
    obj?.reference === transactionId ||
    obj?.transactionId === transactionId ||
    obj?.orderNo === transactionId;

  let txList = null;
  if (Array.isArray(input)) {
    txList = input;
  } else if (Array.isArray(root?.transactions)) {
    txList = root.transactions;
  } else if (Array.isArray(root?.items)) {
    txList = root.items;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (matchesId(root)) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (matchesId(wrapped)) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected transactions array or matching receipt payload");
  }

  const rows = txList.filter((r) => matchesId(object(r)));
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.type ?? row.transactionType;
  const isWallet =
    rawType === "walletTransfer" ||
    rawType === "wallet_transfer" ||
    rawType === "wallet" ||
    rawType === "transfer" ||
    rawType === "p2p";

  const isNip =
    rawType === "bankTransfer" ||
    rawType === "bank_transfer" ||
    rawType === "nip" ||
    rawType === "nipTransfer" ||
    rawType === "nip_transfer";

  if (!isWallet && !isNip) {
    return {
      outcome: "unsupported",
      reason: "Only outgoing NGN wallet and bank transfers are supported",
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
  const completedStatuses = ["SUCCESS", "SUCCESSFUL", "COMPLETED"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not network-reported completed");
  }

  if (row.currency !== CURRENCY) {
    return fail("Missing or conflicting currency: only NGN is supported");
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
    .replace(/^(?:NGN|₦)\s*/i, "")
    .replace(/\s*(?:NGN)$/i, "")
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

  const rawTime = row.completedAt ?? row.timestamp ?? row.transferredAt;
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
   * Normalize Nigerian account / phone number to 10-digit NUBAN.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeNuban = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\+234\d{10}$/.test(clean)) return clean.slice(4);
    if (/^234\d{10}$/.test(clean)) return clean.slice(3);
    if (/^0\d{10}$/.test(clean)) return clean.slice(1);
    if (/^\d{10}$/.test(clean)) return clean;
    return null;
  };

  const payer = object(row.payer) ?? account;
  const payerNuban = normalizeNuban(
    payer?.accountNumber ?? payer?.account ?? payer?.phone ?? payer?.id,
  );
  if (!payerNuban) {
    return fail("Valid unmasked payer Nigerian NUBAN account number is required");
  }

  const payee = object(row.payee);
  const payeeNuban = normalizeNuban(
    payee?.accountNumber ?? payee?.account ?? payee?.phone ?? payee?.id,
  );
  if (!payeeNuban) {
    return fail("Valid unmasked destination Nigerian NUBAN account number is required");
  }

  let payeeId = payeeNuban;
  if (isNip) {
    const rawBankCode = typeof payee?.bankCode === "string" ? payee.bankCode.trim() : "";
    if (!/^[a-zA-Z0-9]{3,6}$/.test(rawBankCode)) {
      return fail("Bank transfer requires a valid destination bank code");
    }
    payeeId = `${rawBankCode}:${payeeNuban}`;
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "ng/opay",
      transactionId,
      payer: {
        id: payerNuban,
        scheme: "ng-nuban",
        provenance: object(row.payer) ? "transaction.payer" : "account.number",
      },
      payee: {
        id: payeeId,
        scheme: "ng-nuban",
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
        "Payer and payee identities are Nigerian NUBAN account numbers, not verified legal persons.",
        "Transaction reference number is local to OPay or NIBSS; no cross-network deduplication is claimed.",
        "Domestic transfers are subject to Central Bank of Nigeria regulatory limits and OPay tier terms.",
      ],
    },
  };
}
