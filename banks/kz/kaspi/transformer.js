/**
 * Pure, read-only Kaspi Bank Kazakhstan transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt from Kaspi.kz.
 * @param {string} transactionId The explicitly selected transaction or receipt identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretKaspi(input, transactionId) {
  const CURRENCY = "KZT";
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
    root?.transactionId === transactionId ||
    root?.receiptNumber === transactionId
  ) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (
      wrapped?.id === transactionId ||
      wrapped?.transactionId === transactionId ||
      wrapped?.receiptNumber === transactionId
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
      obj?.transactionId === transactionId ||
      obj?.receiptNumber === transactionId
    );
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.paymentType ?? row.type ?? row.transactionType;
  if (
    row.isKaspiRed === true ||
    row.isKaspiKredit === true ||
    row.isKaspiPay === true ||
    row.isUtility === true ||
    row.isMobileTopup === true ||
    row.isTax === true ||
    row.isFx === true ||
    rawType === "kaspi_red" ||
    rawType === "kaspi_kredit" ||
    rawType === "kaspi_pay" ||
    rawType === "utility_payment" ||
    rawType === "mobile_topup" ||
    rawType === "tax_payment" ||
    rawType === "fx_exchange"
  ) {
    return {
      outcome: "unsupported",
      reason:
        "Kaspi Red, Kaspi Kredit, Kaspi Pay merchant QR, utilities, and tax payments are excluded",
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

  const isKztCurrency =
    row.currency === CURRENCY ||
    row.currency === "398" ||
    row.currency === 398 ||
    row.currencyCode === "398" ||
    row.currencyCode === 398;
  if (!isKztCurrency) {
    return fail("Missing or conflicting currency: only KZT is supported");
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
    .replace(/^(?:KZT|₸)\s*/i, "")
    .replace(/\s*(?:KZT|₸)$/i, "")
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
   * Normalize Kazakhstani mobile phone number to E.164 (+77XXXXXXXXX).
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeKzPhone = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\+77\d{9}$/.test(clean)) return clean;
    if (/^77\d{9}$/.test(clean)) return `+${clean}`;
    if (/^87\d{9}$/.test(clean)) return `+7${clean.slice(1)}`;
    if (/^\+7\d{10}$/.test(clean)) return clean;
    return null;
  };

  /**
   * Validate 16-digit card number format.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeCardPan = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/[\s-]/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^\d{16}$/.test(clean)) return clean;
    return null;
  };

  const payerObj = object(row.payer) ?? object(row.account) ?? account;
  const payerPhoneCandidate = payerObj?.phone ?? payerObj?.mobileNumber ?? payerObj?.id;
  const payerPhone = normalizeKzPhone(payerPhoneCandidate);
  let payerId = payerPhone;
  let payerScheme = "kz-msisdn";
  let payerProvenance = "account.phone";

  if (!payerId) {
    const payerCard = normalizeCardPan(payerObj?.cardNumber ?? payerObj?.card);
    if (payerCard) {
      payerId = payerCard;
      payerScheme = "pan";
      payerProvenance = "payer.cardNumber";
    } else {
      return fail("Valid unmasked payer Kazakh phone number or card number is required");
    }
  }

  const payeeObj = object(row.payee);
  const payeePhoneCandidate = payeeObj?.phone ?? payeeObj?.mobileNumber ?? payeeObj?.id;
  const payeePhone = normalizeKzPhone(payeePhoneCandidate);
  let payeeId = payeePhone;
  let payeeScheme = "kz-msisdn";
  let payeeProvenance = "transaction.payee";

  if (!payeeId) {
    const payeeCard = normalizeCardPan(payeeObj?.cardNumber ?? payeeObj?.card ?? row.payeeCard);
    if (payeeCard) {
      payeeId = payeeCard;
      payeeScheme = "pan";
      payeeProvenance = "payee.cardNumber";
    } else {
      return fail(
        "Valid unmasked destination phone number or card identifier is required; partial display names fail closed",
      );
    }
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "kz/kaspi",
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
      timestamp: rawTime,
      timestampMeaning: "completedAt",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the bank reported status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are Kazakh mobile phone or card numbers, not verified legal persons.",
        "Transaction identifier is local to Kaspi.kz; no cross network deduplication is claimed.",
        "Transfers are subject to Kaspi.kz account limits and National Bank of Kazakhstan regulations.",
      ],
    },
  };
}
