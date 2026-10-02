import { describe, expect, it } from "vitest";
import { interpretVietcombank } from "./transformer.js";

describe("interpretVietcombank", () => {
  const basePayer = "0123456789";
  const basePayee = "9876543210";
  const baseTxId = "vcb-tx-001";

  const validTx = () => ({
    id: baseTxId,
    transferType: "intra_bank",
    direction: "debit",
    status: "SUCCESS",
    amount: 2500000,
    currency: "VND",
    completedAt: "2026-10-02T16:00:00Z",
    senderAccount: basePayer,
    recipient: {
      accountNumber: basePayee,
      name: "Synthetic Payee",
      bank: "Vietcombank",
    },
  });

  it("interprets a valid completed intra-bank VND transfer", () => {
    const res = interpretVietcombank([validTx()], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.amountMinor).toBe("2500000");
      expect(res.payment.currency).toBe("VND");
      expect(res.payment.currencyExponent).toBe(0);
      expect(res.payment.payer.id).toBe(basePayer);
      expect(res.payment.payee.id).toBe(basePayee);
      expect(res.payment.status).toBe("SUCCESS");
    }
  });

  it("interprets input envelopes across array, statement, items, data, receipt, and transaction objects", () => {
    const tx = validTx();
    expect(interpretVietcombank({ statement: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank({ items: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank({ data: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank({ transactions: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank(tx, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank({ receipt: tx }, baseTxId).outcome).toBe("supported");
    expect(interpretVietcombank({ transaction: tx }, baseTxId).outcome).toBe("supported");

    const txByTxId = { ...tx, id: undefined, transactionId: "ref-123" };
    expect(interpretVietcombank(txByTxId, "ref-123").outcome).toBe("supported");
    expect(interpretVietcombank({ receipt: txByTxId }, "ref-123").outcome).toBe("supported");

    const txByRef = { ...tx, id: undefined, referenceNumber: "ref-456" };
    expect(interpretVietcombank(txByRef, "ref-456").outcome).toBe("supported");
    expect(interpretVietcombank({ transaction: txByRef }, "ref-456").outcome).toBe("supported");
  });

  it("handles alternative payer and payee account field paths", () => {
    const txPayerAcc = {
      ...validTx(),
      senderAccount: undefined,
      payer: { accountNumber: "123456789012" },
      recipient: undefined,
      payee: { accountNumber: "987654321098" },
    };
    const res1 = interpretVietcombank([txPayerAcc], baseTxId);
    expect(res1.outcome).toBe("supported");
    if (res1.outcome === "supported") {
      expect(res1.payment.payer.id).toBe("123456789012");
      expect(res1.payment.payee.id).toBe("987654321098");
    }

    const txAccountObj = {
      ...validTx(),
      senderAccount: undefined,
      account: { account: "001100223344" },
      recipient: { account: "002200334455" },
    };
    const res2 = interpretVietcombank([txAccountObj], baseTxId);
    expect(res2.outcome).toBe("supported");
    if (res2.outcome === "supported") {
      expect(res2.payment.payer.id).toBe("001100223344");
      expect(res2.payment.payee.id).toBe("002200334455");
    }

    const txIdFallback = {
      ...validTx(),
      senderAccount: undefined,
      payer: { id: "payer-acc-01" },
      recipient: undefined,
      payee: { id: "payee-acc-02" },
    };
    const res3 = interpretVietcombank([txIdFallback], baseTxId);
    expect(res3.outcome).toBe("supported");
    if (res3.outcome === "supported") {
      expect(res3.payment.payer.id).toBe("payer-acc-01");
      expect(res3.payment.payee.id).toBe("payee-acc-02");
    }
  });

  it("handles NAPAS 247 transfers and Vietnamese status codes", () => {
    const txNapas = {
      ...validTx(),
      transferType: "napas_247",
      status: "THANH_CONG",
    };
    const res = interpretVietcombank([txNapas], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.status).toBe("THANH_CONG");
    }

    expect(interpretVietcombank([{ ...validTx(), status: "COMPLETED" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "SUCCESSFUL" }], baseTxId).outcome).toBe(
      "supported",
    );
  });

  it("handles whole VND amount strings with commas, dots, and trailing zero decimals", () => {
    const txDotZero = { ...validTx(), amount: "2500000.00" };
    expect(interpretVietcombank([txDotZero], baseTxId).outcome).toBe("supported");

    const txFormatted = { ...validTx(), amount: "2,500,000 đ" };
    expect(interpretVietcombank([txFormatted], baseTxId).outcome).toBe("supported");

    const txDongPrefix = { ...validTx(), amount: "VND 1000000" };
    expect(interpretVietcombank([txDongPrefix], baseTxId).outcome).toBe("supported");

    const txNumericCode = { ...validTx(), currency: "704" };
    expect(interpretVietcombank([txNumericCode], baseTxId).outcome).toBe("supported");

    const txNumericCodeNum = { ...validTx(), currency: undefined, currencyCode: 704 };
    expect(interpretVietcombank([txNumericCodeNum], baseTxId).outcome).toBe("supported");

    const txNumericCodeStr = { ...validTx(), currency: undefined, currencyCode: "704" };
    expect(interpretVietcombank([txNumericCodeStr], baseTxId).outcome).toBe("supported");
  });

  it("rejects invalid, missing, or blank transaction id", () => {
    expect(interpretVietcombank([validTx()], "").outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank([validTx()], "   ").outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank([validTx()], null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects non-array and non-object input envelopes", () => {
    expect(interpretVietcombank(null, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank("invalid", baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank({}, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank([], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("rejects absent or duplicate transaction selections", () => {
    const tx = validTx();
    expect(interpretVietcombank([tx], "non-existent").outcome).toBe("insufficient_evidence");
    expect(interpretVietcombank([tx, tx], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for excluded categories and incoming directions", () => {
    expect(interpretVietcombank([{ ...validTx(), isBillPayment: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), isMobileTopup: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), isQrMerchant: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), isInternational: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), isFixedDeposit: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), isLoan: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(
      interpretVietcombank(
        [{ ...validTx(), transferType: undefined, type: "bill_payment" }],
        baseTxId,
      ).outcome,
    ).toBe("unsupported");
    expect(
      interpretVietcombank(
        [{ ...validTx(), transferType: undefined, paymentType: "mobile_topup" }],
        baseTxId,
      ).outcome,
    ).toBe("unsupported");
    expect(
      interpretVietcombank([{ ...validTx(), transferType: "qr_merchant" }], baseTxId).outcome,
    ).toBe("unsupported");
    expect(interpretVietcombank([{ ...validTx(), direction: "incoming" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretVietcombank([{ ...validTx(), direction: "credit" }], baseTxId).outcome).toBe(
      "unsupported",
    );
  });

  it("fails closed on pending, processing, failed, reversed, or cancelled status", () => {
    expect(interpretVietcombank([{ ...validTx(), status: "PENDING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "DANG_XU_LY" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "PROCESSING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "FAILED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "THAT_BAI" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "CANCELLED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "REVERSED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: "UNKNOWN" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), status: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on conflicting currency", () => {
    expect(interpretVietcombank([{ ...validTx(), currency: "USD" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), currency: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid amounts including fractional VND", () => {
    expect(interpretVietcombank([{ ...validTx(), amount: 0 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: -100 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: 2500000.5 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: Number.NaN }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "-1000" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "+1000" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "2500000.50" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "2500000.1234" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "abc" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: "0" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretVietcombank([{ ...validTx(), amount: true }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid timestamps", () => {
    expect(
      interpretVietcombank([{ ...validTx(), completedAt: "not-a-date" }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretVietcombank([{ ...validTx(), completedAt: "2026-02-31T16:00:00Z" }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(interpretVietcombank([{ ...validTx(), completedAt: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on masked or invalid payer and payee identifiers", () => {
    expect(interpretVietcombank([{ ...validTx(), senderAccount: "   " }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretVietcombank([{ ...validTx(), senderAccount: "0123****89" }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretVietcombank([{ ...validTx(), senderAccount: "12" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretVietcombank(
        [{ ...validTx(), senderAccount: undefined, payer: undefined, account: undefined }],
        baseTxId,
      ).outcome,
    ).toBe("insufficient_evidence");

    expect(
      interpretVietcombank([{ ...validTx(), recipient: { accountNumber: "   " } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretVietcombank([{ ...validTx(), recipient: { accountNumber: "98••••3210" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretVietcombank([{ ...validTx(), recipient: { accountNumber: "12" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretVietcombank([{ ...validTx(), recipient: undefined, payee: undefined }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
  });
});
