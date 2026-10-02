/**
 * Pure, read-only bKash Bangladesh transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt from bKash.
 * @param {string} transactionId The explicitly selected transaction or TrxID identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretBkash(input, transactionId) {
  const CURRENCY = "BDT";
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
  } else if (Array.isArray(root?.statement)) {
    txList = root.statement;
  } else if (Array.isArray(root?.items)) {
    txList = root.items;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (
    root?.id === transactionId ||
    root?.trxId === transactionId ||
    root?.transactionId === transactionId
  ) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (
      wrapped?.id === transactionId ||
      wrapped?.trxId === transactionId ||
      wrapped?.transactionId === transactionId
    ) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected transactions array or matching receipt payload");
  }

  const rows = txList.filter((r) => {
    const obj = object(r);
    return (
      obj?.id === transactionId ||
      obj?.trxId === transactionId ||
      obj?.transactionId === transactionId
    );
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.paymentType ?? row.type ?? row.transactionType;
  if (
    row.isCashOut === true ||
    row.cashOut === true ||
    rawType === "cash_out" ||
    rawType === "CashOut" ||
    rawType === "Cash Out" ||
    rawType === "cashOut" ||
    row.isMerchant === true ||
    rawType === "merchant_payment" ||
    rawType === "merchant" ||
    row.isMobileRecharge === true ||
    rawType === "mobile_recharge" ||
    rawType === "recharge" ||
    row.isPayBill === true ||
    rawType === "pay_bill" ||
    rawType === "bill_payment" ||
    rawType === "add_money" ||
    row.isAddMoney === true
  ) {
    return {
      outcome: "unsupported",
      reason: "Cash Out, merchant payments, and mobile recharge are excluded",
    };
  }

  if (
    rawType !== "SendMoney" &&
    rawType !== "send_money" &&
    rawType !== "Send Money" &&
    rawType !== "sendMoney" &&
    rawType !== "p2p" &&
    rawType !== "domesticTransfer" &&
    rawType !== "transfer"
  ) {
    return {
      outcome: "unsupported",
      reason: "Only outgoing BDT Send Money transfers are supported",
    };
  }

  if (row.direction !== "debit" && row.direction !== "outgoing") {
    return {
      outcome: "unsupported",
      reason: "Only outgoing debit transfers are supported",
    };
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

  const isBdtCurrency =
    row.currency === CURRENCY ||
    row.currency === "050" ||
    row.currency === 50 ||
    row.currencyCode === "050" ||
    row.currencyCode === 50;
  if (!isBdtCurrency) {
    return fail("Missing or conflicting currency: only BDT is supported");
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
    .replace(/^(?:BDT|Tk|৳)\s*/i, "")
    .replace(/\s*(?:BDT|Tk|৳)$/i, "")
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

  const rawTime = row.bookedAt ?? row.completedAt ?? row.timestamp;
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
   * Normalize Bangladeshi mobile phone number to E.164 (+8801XXXXXXXXX).
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeBdPhone = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\+8801\d{9}$/.test(clean)) return clean;
    if (/^8801\d{9}$/.test(clean)) return `+${clean}`;
    if (/^01\d{9}$/.test(clean)) return `+88${clean}`;
    return null;
  };

  const payerObj = object(row.payer) ?? object(row.account) ?? account;
  const payerRaw = payerObj?.mobileNumber ?? payerObj?.phone ?? payerObj?.id;
  const payerPhone = normalizeBdPhone(payerRaw);
  if (!payerPhone) {
    return fail("Valid unmasked payer Bangladeshi phone number is required");
  }

  const payeeObj = object(row.payee);
  const payeeRaw = payeeObj?.mobileNumber ?? payeeObj?.phone ?? payeeObj?.id;
  const payeePhone = normalizeBdPhone(payeeRaw);
  if (!payeePhone) {
    return fail("Valid unmasked destination Bangladeshi phone number is required");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "bd/bkash",
      transactionId,
      payer: {
        id: payerPhone,
        scheme: "bd-msisdn",
        provenance: "account.mobileNumber",
      },
      payee: {
        id: payeePhone,
        scheme: "bd-msisdn",
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
        "Completed is the bank reported status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are mobile phone numbers, not verified legal persons.",
        "Transaction TrxID identifier is local to bKash; no cross network deduplication is claimed.",
        "Send Money transfers are subject to bKash wallet transaction limits and Bangladesh Bank regulations.",
      ],
    },
  };
}
