/**
 * Pure, read-only Vietcombank Vietnam transaction interpretation.
 * No login, network, clock, randomness, or logging.
 *
 * @param {unknown} input The response envelope or receipt from Vietcombank Digibank.
 * @param {string} transactionId The explicitly selected transaction or reference identifier.
 * @returns {import('../../../lib/types.js').Interpretation}
 */
export function interpretVietcombank(input, transactionId) {
  const CURRENCY = "VND";
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
  } else if (Array.isArray(root?.statement)) {
    txList = root.statement;
  } else if (Array.isArray(root?.items)) {
    txList = root.items;
  } else if (Array.isArray(root?.data)) {
    txList = root.data;
  } else if (
    root?.id === transactionId ||
    root?.transactionId === transactionId ||
    root?.referenceNumber === transactionId
  ) {
    txList = [root];
  } else {
    const wrapped = object(root?.receipt) ?? object(root?.transaction);
    if (
      wrapped?.id === transactionId ||
      wrapped?.transactionId === transactionId ||
      wrapped?.referenceNumber === transactionId
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
      obj?.referenceNumber === transactionId
    );
  });
  if (rows.length !== 1) {
    return fail("Selected transaction must occur exactly once");
  }

  const row = /** @type {Record<string, unknown>} */ (rows[0]);

  const rawType = row.transferType ?? row.type ?? row.paymentType;
  if (
    row.isBillPayment === true ||
    row.isMobileTopup === true ||
    row.isQrMerchant === true ||
    row.isInternational === true ||
    row.isFixedDeposit === true ||
    row.isLoan === true ||
    rawType === "bill_payment" ||
    rawType === "mobile_topup" ||
    rawType === "qr_merchant"
  ) {
    return {
      outcome: "unsupported",
      reason: "Bill payments, mobile top-ups, merchant QR, and loan transactions are excluded",
    };
  }

  if (row.direction === "credit" || row.direction === "incoming") {
    return {
      outcome: "unsupported",
      reason: "Incoming transfers and credit payments are excluded",
    };
  }

  if (row.status === "PENDING" || row.status === "DANG_XU_LY" || row.status === "PROCESSING") {
    return fail("Transaction is still pending execution");
  }
  if (
    row.status === "FAILED" ||
    row.status === "THAT_BAI" ||
    row.status === "CANCELLED" ||
    row.status === "REVERSED"
  ) {
    return fail("Transaction failed or was reversed");
  }

  const completedStatuses = ["SUCCESS", "COMPLETED", "THANH_CONG", "SUCCESSFUL"];
  if (typeof row.status !== "string" || !completedStatuses.includes(row.status)) {
    return fail("Transaction is not network-reported completed");
  }

  const isVndCurrency =
    row.currency === CURRENCY ||
    row.currency === "704" ||
    row.currencyCode === 704 ||
    row.currencyCode === "704";
  if (!isVndCurrency) {
    return fail("Missing or conflicting currency: only VND is supported");
  }

  let minor = 0n;
  if (typeof row.amount === "number") {
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      return fail("Amount must be a positive number");
    }
    if (!Number.isInteger(row.amount)) {
      return fail("VND amounts must be whole Vietnamese dong integers without fractional units");
    }
    minor = BigInt(row.amount);
  } else if (typeof row.amount === "string") {
    let clean = row.amount
      .trim()
      .replace(/^(?:VND|đ|Đ)\s*/i, "")
      .replace(/\s*(?:VND|đ|Đ)$/i, "")
      .trim();
    if (clean.startsWith("-") || clean.startsWith("+")) {
      return fail("Amount must not include leading arithmetic signs");
    }
    const decMatch = /[.,](\d+)$/.exec(clean);
    if (decMatch) {
      const sep = clean[decMatch.index];
      const frac = decMatch[1];
      if (frac.length <= 2) {
        if (/^0+$/.test(frac)) {
          clean = clean.slice(0, decMatch.index);
        } else {
          return fail(
            "VND amounts must be whole Vietnamese dong integers without fractional units",
          );
        }
      } else {
        const earlierSep = clean.slice(0, decMatch.index).includes(sep);
        if (!earlierSep && frac.length !== 3) {
          return fail(
            "VND amounts must be whole Vietnamese dong integers without fractional units",
          );
        }
      }
    }
    clean = clean.replace(/[,.\s]/g, "");
    if (!/^(0|[1-9]\d{0,14})$/.test(clean)) {
      return fail("Amount must be a whole non-negative integer string");
    }
    minor = BigInt(clean);
  } else {
    return fail("Amount must be a number or integer string");
  }

  if (minor <= 0n) return fail("Amount must be positive");

  const rawTime = row.completedAt ?? row.timestamp;
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
   * Validate unmasked account identifier.
   * @param {unknown} val
   * @returns {string | null}
   */
  const normalizeAccountNumber = (val) => {
    if (typeof val !== "string") return null;
    const clean = val.replace(/\s/g, "");
    if (clean.length === 0 || /[*•?]/.test(clean)) return null;
    if (/^[A-Za-z0-9-]{6,24}$/.test(clean)) return clean;
    return null;
  };

  const payerObj = object(row.payer) ?? object(row.account) ?? account;
  const payerRaw =
    row.senderAccount ?? payerObj?.accountNumber ?? payerObj?.account ?? payerObj?.id;
  const payerId = normalizeAccountNumber(payerRaw);
  if (!payerId) {
    return fail("Valid unmasked payer Vietcombank account number is required");
  }

  const payeeObj = object(row.recipient) ?? object(row.payee);
  const payeeRaw = payeeObj?.accountNumber ?? payeeObj?.account ?? payeeObj?.id;
  const payeeId = normalizeAccountNumber(payeeRaw);
  if (!payeeId) {
    return fail("Valid unmasked destination bank account number is required");
  }

  return {
    outcome: "supported",
    payment: {
      schemaVersion: "2",
      provider: "vn/vietcombank",
      transactionId,
      payer: {
        id: payerId,
        scheme: "vn-vcb-account",
        provenance: "transaction.senderAccount",
      },
      payee: {
        id: payeeId,
        scheme: "vn-bank-account",
        provenance: "transaction.recipient",
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
        "Payer and payee identities are domestic bank account numbers, not verified legal persons.",
        "Transaction identifier is local to Vietcombank; no cross network deduplication is claimed.",
        "Transfers are subject to Vietcombank Digibank transaction limits and Vietnamese banking regulations.",
      ],
    },
  };
}
