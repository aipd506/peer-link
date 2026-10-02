import { describe, expect, it } from "vitest";
import { interpretKaspi } from "./transformer.js";

describe("interpretKaspi", () => {
  const basePayer = "+77000000001";
  const basePayee = "+77000000002";
  const baseTxId = "KZ2026100200001";

  const validTx = () => ({
    id: baseTxId,
    type: "domesticTransfer",
    paymentType: "KaspiTransfer",
    direction: "debit",
    status: "COMPLETED",
    amount: "25000.00",
    currency: "KZT",
    bookedAt: "2026-10-02T16:00:00Z",
    payer: { phone: basePayer },
    payee: { phone: basePayee, name: "Arman K." },
  });

  it("interprets a valid completed outgoing Kaspi phone transfer", () => {
    const res = interpretKaspi([validTx()], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.amountMinor).toBe("2500000");
      expect(res.payment.currency).toBe("KZT");
      expect(res.payment.currencyExponent).toBe(2);
      expect(res.payment.payer.id).toBe(basePayer);
      expect(res.payment.payer.scheme).toBe("kz-msisdn");
      expect(res.payment.payee.id).toBe(basePayee);
      expect(res.payment.payee.scheme).toBe("kz-msisdn");
      expect(res.payment.status).toBe("COMPLETED");
    }
  });

  it("interprets a valid card-to-card transfer with PAN scheme", () => {
    const txCard = {
      ...validTx(),
      paymentType: "CardTransfer",
      payer: { cardNumber: "4405630000001111" },
      payee: { cardNumber: "4405630000002222", name: "Synthetic Payee" },
    };
    const res = interpretKaspi([txCard], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.payer.id).toBe("4405630000001111");
      expect(res.payment.payer.scheme).toBe("pan");
      expect(res.payment.payee.id).toBe("4405630000002222");
      expect(res.payment.payee.scheme).toBe("pan");
    }
  });

  it("interprets input envelopes across array, statement, items, data, receipt, and transaction objects", () => {
    const tx = validTx();
    expect(interpretKaspi({ statement: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi({ items: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi({ data: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi({ transactions: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi(tx, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi({ receipt: tx }, baseTxId).outcome).toBe("supported");
    expect(interpretKaspi({ transaction: tx }, baseTxId).outcome).toBe("supported");

    const txByTxId = { ...tx, id: undefined, transactionId: "txid-999" };
    expect(interpretKaspi(txByTxId, "txid-999").outcome).toBe("supported");
    expect(interpretKaspi({ receipt: txByTxId }, "txid-999").outcome).toBe("supported");

    const txByRcpt = { ...tx, id: undefined, receiptNumber: "rcpt-888" };
    expect(interpretKaspi(txByRcpt, "rcpt-888").outcome).toBe("supported");
    expect(interpretKaspi({ transaction: txByRcpt }, "rcpt-888").outcome).toBe("supported");
  });

  it("handles alternative Kazakh phone formats and card field fallbacks", () => {
    const txNational = {
      ...validTx(),
      payer: { mobileNumber: "87000000001" },
      payee: { mobileNumber: "77000000002" },
    };
    const resNat = interpretKaspi([txNational], baseTxId);
    expect(resNat.outcome).toBe("supported");
    if (resNat.outcome === "supported") {
      expect(resNat.payment.payer.id).toBe("+77000000001");
      expect(resNat.payment.payee.id).toBe("+77000000002");
    }

    const txAltCard = {
      ...validTx(),
      payer: { card: "4405630000001111" },
      payee: { card: "4405630000002222" },
    };
    expect(interpretKaspi([txAltCard], baseTxId).outcome).toBe("supported");

    const txAltPhone = {
      ...validTx(),
      payer: { phone: "+76000000001" },
      payee: { phone: "+76000000002" },
    };
    expect(interpretKaspi([txAltPhone], baseTxId).outcome).toBe("supported");

    const txFallbackType = {
      ...validTx(),
      paymentType: undefined,
      type: "TRANSFER",
    };
    expect(interpretKaspi([txFallbackType], baseTxId).outcome).toBe("supported");

    const txFallbackTxType = {
      ...validTx(),
      paymentType: undefined,
      type: undefined,
      transactionType: "TRANSFER",
    };
    expect(interpretKaspi([txFallbackTxType], baseTxId).outcome).toBe("supported");

    const txPayeeCardProp = {
      ...validTx(),
      payer: { card: "4405630000001111" },
      payee: undefined,
      payeeCard: "4405630000002222",
    };
    expect(interpretKaspi([txPayeeCardProp], baseTxId).outcome).toBe("supported");
  });

  it("handles numeric amount, formatted currency symbols, and comma thousands", () => {
    const txNum = { ...validTx(), amount: 25000.5 };
    const resNum = interpretKaspi([txNum], baseTxId);
    expect(resNum.outcome).toBe("supported");
    if (resNum.outcome === "supported") {
      expect(resNum.payment.amountMinor).toBe("2500050");
    }

    expect(interpretKaspi([{ ...validTx(), amount: "25,000.00 KZT" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "25000 ₸" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "25000" }], baseTxId).outcome).toBe("supported");
    expect(interpretKaspi([{ ...validTx(), currency: "398" }], baseTxId).outcome).toBe("supported");
    expect(
      interpretKaspi([{ ...validTx(), currency: undefined, currencyCode: 398 }], baseTxId).outcome,
    ).toBe("supported");
    expect(
      interpretKaspi([{ ...validTx(), currency: undefined, currencyCode: "398" }], baseTxId)
        .outcome,
    ).toBe("supported");
    expect(interpretKaspi([{ ...validTx(), status: "SUCCESS" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(
      interpretKaspi([{ ...validTx(), status: "SUCCESSFUL", direction: "outgoing" }], baseTxId)
        .outcome,
    ).toBe("supported");
  });

  it("rejects invalid, missing, or blank transaction id", () => {
    expect(interpretKaspi([validTx()], "").outcome).toBe("insufficient_evidence");
    expect(interpretKaspi([validTx()], "   ").outcome).toBe("insufficient_evidence");
    expect(interpretKaspi([validTx()], null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects non-array and non-object input envelopes", () => {
    expect(interpretKaspi(null, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretKaspi("invalid", baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretKaspi({}, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretKaspi([], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("rejects absent or duplicate transaction selections", () => {
    const tx = validTx();
    expect(interpretKaspi([tx], "different-id").outcome).toBe("insufficient_evidence");
    expect(interpretKaspi([tx, tx], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for Kaspi Red, Kredit, QR, utilities, taxes, and incoming directions", () => {
    expect(interpretKaspi([{ ...validTx(), isKaspiRed: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), isKaspiKredit: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), isKaspiPay: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), isUtility: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), isMobileTopup: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), isTax: true }], baseTxId).outcome).toBe("unsupported");
    expect(interpretKaspi([{ ...validTx(), isFx: true }], baseTxId).outcome).toBe("unsupported");
    expect(interpretKaspi([{ ...validTx(), paymentType: "kaspi_red" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), paymentType: "kaspi_kredit" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), paymentType: "kaspi_pay" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(
      interpretKaspi([{ ...validTx(), paymentType: "utility_payment" }], baseTxId).outcome,
    ).toBe("unsupported");
    expect(interpretKaspi([{ ...validTx(), paymentType: "mobile_topup" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), paymentType: "tax_payment" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), paymentType: "fx_exchange" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), direction: "incoming" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretKaspi([{ ...validTx(), direction: "credit" }], baseTxId).outcome).toBe(
      "unsupported",
    );
  });

  it("fails closed on pending, processing, failed, reversed, or cancelled status", () => {
    expect(interpretKaspi([{ ...validTx(), status: "PENDING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: "PROCESSING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: "FAILED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: "CANCELLED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: "REVERSED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: "UNKNOWN" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), status: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on conflicting currency", () => {
    expect(interpretKaspi([{ ...validTx(), currency: "USD" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), currency: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid amounts", () => {
    expect(interpretKaspi([{ ...validTx(), amount: 0 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: -100 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: Number.NaN }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "25000.555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "25000,555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "25,000,50" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "abc" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: "0.00" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretKaspi([{ ...validTx(), amount: true }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid timestamps", () => {
    expect(interpretKaspi([{ ...validTx(), bookedAt: "not-a-date" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretKaspi([{ ...validTx(), bookedAt: "2026-02-31T16:00:00Z" }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretKaspi([{ ...validTx(), bookedAt: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed when payee has only partial display name without phone or card", () => {
    const txOnlyDisplayName = {
      ...validTx(),
      payee: { name: "Arman K." },
    };
    const res = interpretKaspi([txOnlyDisplayName], baseTxId);
    expect(res.outcome).toBe("insufficient_evidence");
    if (res.outcome === "insufficient_evidence") {
      expect(res.reason).toContain("partial display names fail closed");
    }
  });

  it("fails closed on masked or invalid payer and payee telephone numbers or cards", () => {
    expect(interpretKaspi([{ ...validTx(), payer: { phone: "   " } }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretKaspi([{ ...validTx(), payer: { phone: "+7700****0001" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretKaspi([{ ...validTx(), payer: { phone: "12345" } }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretKaspi([{ ...validTx(), payer: { cardNumber: "440563****001111" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretKaspi([{ ...validTx(), payer: { cardNumber: "12345" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretKaspi([{ ...validTx(), payer: undefined, account: undefined }], baseTxId).outcome,
    ).toBe("insufficient_evidence");

    expect(interpretKaspi([{ ...validTx(), payee: { phone: "   " } }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretKaspi([{ ...validTx(), payee: { phone: "+7700••••0002" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretKaspi([{ ...validTx(), payee: { phone: "12345" } }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretKaspi([{ ...validTx(), payee: { cardNumber: "440563••••002222" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretKaspi([{ ...validTx(), payee: { cardNumber: "12345" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretKaspi([{ ...validTx(), payee: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });
});
