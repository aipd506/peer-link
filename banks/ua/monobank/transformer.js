/**
 * Pure, read-only Monobank Ukraine transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or statement from Monobank.
 * @param {string} transactionId The explicitly selected transaction or receipt identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretMonobank(input, transactionId) {
  const CURRENCY = "UAH";
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
  } else if (root?.id === transactionId || root?.receiptId === transactionId) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (wrapped?.id === transactionId || wrapped?.receiptId === transactionId) {
      txList = [wrapped];
    }
  }

  if (!txList) {
    return fail("Expected transactions array or matching receipt payload");
  }

  const rows = txList.filter((r) => {
    const obj = object(r);
    return obj?.id === transactionId || obj?.receiptId === transactionId;
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  if (
    row.isMerchant === true ||
    row.isUtility === true ||
    row.isMobileTopup === true ||
    row.isCashWithdrawal === true ||
    row.isJar === true ||
    (typeof row.mcc === "number" && row.mcc !== 4829 && row.mcc !== 6538 && row.mcc !== 6012)
  ) {
    return {
      outcome: "unsupported",
      reason: "Merchant purchases, utilities, cash withdrawals, and jar transactions are excluded",
    };
  }

  if (row.direction === "credit" || row.direction === "incoming") {
    return {
      outcome: "unsupported",
      reason: "Incoming transfers and credit payments are excluded",
    };
  }

  if (row.hold === true || row.status === "PENDING" || row.status === "PROCESSING") {
    return fail("Transaction is still pending execution");
  }
  if (row.status === "FAILED" || row.status === "CANCELLED" || row.status === "REVERSED") {
    return fail("Transaction failed or was reversed");
  }

  const completedStatuses = ["COMPLETED", "SUCCESS", "SUCCESSFUL", "SETTLED", "CONFIRMED"];
  if (typeof row.status === "string" && !completedStatuses.includes(row.status)) {
    return fail("Transaction is not network-reported completed");
  }
  if (row.status === undefined && row.hold !== false) {
    return fail("Transaction status is ambiguous");
  }

  const isUahCurrency =
    row.currency === CURRENCY || row.currencyCode === 980 || row.currencyCode === "980";
  if (!isUahCurrency) {
    return fail("Missing or conflicting currency: only UAH is supported");
  }

  let minor = 0n;
  if (typeof row.amount === "number") {
    if (!Number.isFinite(row.amount) || row.amount === 0) {
      return fail("Amount must be a non-zero number");
    }
    const absVal = Math.abs(row.amount);
    if (Number.isInteger(absVal)) {
      minor = BigInt(absVal);
    } else {
      const parts = absVal.toString().split(".");
      if (parts[1].length > EXPONENT) {
        return fail("Amount fraction exceeds currency exponent");
      }
      minor = BigInt(parts[0]) * 100n + BigInt(parts[1].padEnd(EXPONENT, "0"));
    }
  } else if (typeof row.amount === "string") {
    let clean = row.amount
      .trim()
      .replace(/^(?:UAH|грн)\s*/i, "")
      .replace(/\s*(?:UAH|грн)$/i, "")
      .trim();
    if (clean.startsWith("-")) clean = clean.slice(1).trim();
    if (clean.startsWith("+")) return fail("Credit transactions are not supported");
    let whole = "";
    let fraction = "";
    if (clean.includes(",")) {
      const parts = clean.split(",");
      if (parts.length === 2 && parts[1].length <= EXPONENT) {
        whole = parts[0].replace(/\s/g, "");
        fraction = parts[1];
      } else {
        return fail("Amount must be a decimal string within currency precision");
      }
    } else if (clean.includes(".")) {
      const parts = clean.split(".");
      if (parts.length === 2 && parts[1].length <= EXPONENT) {
        whole = parts[0].replace(/\s/g, "");
        fraction = parts[1];
      } else {
        return fail("Amount must be a decimal string within currency precision");
      }
    } else {
      whole = clean.replace(/\s/g, "");
      fraction = "";
    }
    if (
      !/^(0|[1-9]\d{0,14})$/.test(whole) ||
      !/^\d*$/.test(fraction) ||
      fraction.length > EXPONENT
    ) {
      return fail("Amount must be a decimal string within currency precision");
    }
    minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(EXPONENT, "0"));
  } else {
    return fail("Amount must be a number or decimal string");
  }

  if (minor <= 0n) return fail("Amount must be positive");

  let resolvedTimestamp = "";
  const rawTime = row.completedAt ?? row.timestamp;
  if (typeof rawTime === "string") {
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
    resolvedTimestamp = rawTime;
  } else if (typeof row.time === "number" && Number.isFinite(row.time) && row.time > 0) {
    const epochMs = row.time > 10000000000 ? row.time : row.time * 1000;
    resolvedTimestamp = new Date(epochMs).toISOString();
  } else {
    return fail("Valid transaction timestamp is required");
  }

  /**
   * Validate Ukrainian IBAN format: UA followed by 27 digits.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeUaIban = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/\s/g, "").toUpperCase();
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^UA\d{27}$/.test(clean)) return clean;
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
  const payerIbanCandidate = payerObj?.iban ?? account?.iban;
  const payerIban = normalizeUaIban(payerIbanCandidate);
  let payerId = payerIban;
  let payerScheme = "ua-iban";
  let payerProvenance = "payer.iban";

  if (!payerId) {
    const payerCard = normalizeCardPan(payerObj?.cardNumber ?? payerObj?.card);
    if (payerCard) {
      payerId = payerCard;
      payerScheme = "pan";
      payerProvenance = "payer.cardNumber";
    } else if (
      typeof payerObj?.id === "string" &&
      text(payerObj.id) &&
      !/[*•?]/.test(payerObj.id)
    ) {
      payerId = payerObj.id;
      payerScheme = "ua-monobank-account";
      payerProvenance = "payer.id";
    } else {
      return fail("Valid unmasked payer IBAN or card number is required");
    }
  }

  const payeeObj = object(row.payee);
  const counterIbanCandidate = row.counterIban ?? payeeObj?.iban;
  const payeeIban = normalizeUaIban(counterIbanCandidate);
  let payeeId = payeeIban;
  let payeeScheme = "ua-iban";
  let payeeProvenance = "transaction.counterIban";

  if (!payeeId) {
    const counterCard = normalizeCardPan(
      row.counterCardNumber ?? payeeObj?.cardNumber ?? payeeObj?.card,
    );
    if (counterCard) {
      payeeId = counterCard;
      payeeScheme = "pan";
      payeeProvenance = "transaction.payeeCard";
    } else if (
      typeof payeeObj?.id === "string" &&
      text(payeeObj.id) &&
      !/[*•?]/.test(payeeObj.id)
    ) {
      payeeId = payeeObj.id;
      payeeScheme = "ua-monobank-account";
      payeeProvenance = "payee.id";
    } else {
      return fail("Valid unmasked payee IBAN or destination card number is required");
    }
  }

  const finalStatus = typeof row.status === "string" ? row.status : "COMPLETED";

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "ua/monobank",
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
      status: finalStatus,
      timestamp: resolvedTimestamp,
      timestampMeaning: "completedAt",
      sourceAuthenticated: false,
      limitations: [
        "Input authenticity is not established by this parser.",
        "Completed is the bank reported status, not proof of recipient credit or irreversible settlement.",
        "Payer and payee identities are IBAN or card identifiers, not verified legal persons.",
        "Transaction identifier is local to Monobank; no cross network deduplication is claimed.",
        "Transfers are subject to Monobank account limits and Ukrainian regulatory requirements.",
      ],
    },
  };
}
