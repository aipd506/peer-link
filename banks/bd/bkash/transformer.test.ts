import { describe, expect, it } from "vitest";
import { interpretBkash } from "./transformer.js";

describe("interpretBkash", () => {
  const basePayer = "+8801700000001";
  const basePayee = "+8801700000002";
  const baseTxId = "BK2026100200001";

  const validTx = () => ({
    id: baseTxId,
    type: "domesticTransfer",
    paymentType: "SendMoney",
    direction: "debit",
    status: "COMPLETED",
    amount: "1500.50",
    currency: "BDT",
    bookedAt: "2026-10-02T16:00:00Z",
    payer: { mobileNumber: basePayer },
    payee: { mobileNumber: basePayee, name: "Synthetic Payee" },
  });

  it("interprets a valid completed outgoing Send Money transfer", () => {
    const res = interpretBkash([validTx()], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.amountMinor).toBe("150050");
      expect(res.payment.currency).toBe("BDT");
      expect(res.payment.currencyExponent).toBe(2);
      expect(res.payment.payer.id).toBe(basePayer);
      expect(res.payment.payee.id).toBe(basePayee);
      expect(res.payment.status).toBe("COMPLETED");
    }
  });

  it("interprets input envelopes across array, statement, items, data, receipt, and transaction objects", () => {
    const tx = validTx();
    expect(interpretBkash({ statement: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretBkash({ items: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretBkash({ data: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretBkash({ transactions: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretBkash(tx, baseTxId).outcome).toBe("supported");
    expect(interpretBkash({ receipt: tx }, baseTxId).outcome).toBe("supported");
    expect(interpretBkash({ transaction: tx }, baseTxId).outcome).toBe("supported");

    const txByTrxId = { ...tx, id: undefined, trxId: "trx-999" };
    expect(interpretBkash(txByTrxId, "trx-999").outcome).toBe("supported");
    expect(interpretBkash({ receipt: txByTrxId }, "trx-999").outcome).toBe("supported");

    const txByTxId = { ...tx, id: undefined, transactionId: "txid-888" };
    expect(interpretBkash(txByTxId, "txid-888").outcome).toBe("supported");
    expect(interpretBkash({ transaction: txByTxId }, "txid-888").outcome).toBe("supported");
  });

  it("accepts valid Send Money transfer type aliases", () => {
    expect(
      interpretBkash(
        [{ ...validTx(), paymentType: undefined, type: undefined, transactionType: "send_money" }],
        baseTxId,
      ).outcome,
    ).toBe("supported");
    expect(interpretBkash([{ ...validTx(), paymentType: "send_money" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "Send Money" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "sendMoney" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "p2p" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "transfer" }], baseTxId).outcome).toBe(
      "supported",
    );
  });

  it("handles alternative phone formatting in national format and fallback fields", () => {
    const txNational = {
      ...validTx(),
      payer: { phone: "01700000001" },
      payee: { phone: "8801700000002" },
    };
    const res = interpretBkash([txNational], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.payer.id).toBe("+8801700000001");
      expect(res.payment.payee.id).toBe("+8801700000002");
    }

    const txAccountFallback = {
      ...validTx(),
      account: { id: "01700000001" },
      payer: undefined,
      payee: { id: "01700000002" },
    };
    const resFallback = interpretBkash([txAccountFallback], baseTxId);
    expect(resFallback.outcome).toBe("supported");
  });

  it("handles numeric amount, formatted currency symbols, and comma thousands", () => {
    const txNum = { ...validTx(), amount: 1500.5 };
    const resNum = interpretBkash([txNum], baseTxId);
    expect(resNum.outcome).toBe("supported");
    if (resNum.outcome === "supported") {
      expect(resNum.payment.amountMinor).toBe("150050");
    }

    expect(interpretBkash([{ ...validTx(), amount: "1,500.50 Tk" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), amount: "BDT 1500.50" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), amount: "1500 ৳" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(interpretBkash([{ ...validTx(), currency: "050" }], baseTxId).outcome).toBe("supported");
    expect(
      interpretBkash([{ ...validTx(), currency: undefined, currencyCode: 50 }], baseTxId).outcome,
    ).toBe("supported");
    expect(
      interpretBkash([{ ...validTx(), currency: undefined, currencyCode: "050" }], baseTxId)
        .outcome,
    ).toBe("supported");
    expect(interpretBkash([{ ...validTx(), status: "SUCCESS" }], baseTxId).outcome).toBe(
      "supported",
    );
    expect(
      interpretBkash([{ ...validTx(), status: "SUCCESSFUL", direction: "outgoing" }], baseTxId)
        .outcome,
    ).toBe("supported");
  });

  it("rejects invalid, missing, or blank transaction id", () => {
    expect(interpretBkash([validTx()], "").outcome).toBe("insufficient_evidence");
    expect(interpretBkash([validTx()], "   ").outcome).toBe("insufficient_evidence");
    expect(interpretBkash([validTx()], null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects non-array and non-object input envelopes", () => {
    expect(interpretBkash(null, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretBkash("invalid", baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretBkash({}, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretBkash([], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("rejects absent or duplicate transaction selections", () => {
    const tx = validTx();
    expect(interpretBkash([tx], "different-id").outcome).toBe("insufficient_evidence");
    expect(interpretBkash([tx, tx], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for Cash Out, merchant, bill payment, recharge, and incoming directions", () => {
    expect(interpretBkash([{ ...validTx(), isCashOut: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), cashOut: true }], baseTxId).outcome).toBe("unsupported");
    expect(interpretBkash([{ ...validTx(), paymentType: "cash_out" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "CashOut" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "Cash Out" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "cashOut" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), isMerchant: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(
      interpretBkash([{ ...validTx(), paymentType: "merchant_payment" }], baseTxId).outcome,
    ).toBe("unsupported");
    expect(interpretBkash([{ ...validTx(), paymentType: "merchant" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), isMobileRecharge: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(
      interpretBkash([{ ...validTx(), paymentType: "mobile_recharge" }], baseTxId).outcome,
    ).toBe("unsupported");
    expect(interpretBkash([{ ...validTx(), paymentType: "recharge" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), isPayBill: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "pay_bill" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "bill_payment" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "add_money" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), isAddMoney: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), paymentType: "unknown_type" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), direction: "incoming" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretBkash([{ ...validTx(), direction: "credit" }], baseTxId).outcome).toBe(
      "unsupported",
    );
  });

  it("fails closed on pending, processing, failed, reversed, or cancelled status", () => {
    expect(interpretBkash([{ ...validTx(), status: "PENDING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: "PROCESSING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: "FAILED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: "CANCELLED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: "REVERSED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: "UNKNOWN" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), status: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on conflicting currency", () => {
    expect(interpretBkash([{ ...validTx(), currency: "USD" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), currency: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid amounts", () => {
    expect(interpretBkash([{ ...validTx(), amount: 0 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: -100 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: Number.NaN }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: "1500.555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: "1500,555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: "1,500,50" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: "abc" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: "0.00" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretBkash([{ ...validTx(), amount: true }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid timestamps", () => {
    expect(interpretBkash([{ ...validTx(), bookedAt: "not-a-date" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretBkash([{ ...validTx(), bookedAt: "2026-02-31T16:00:00Z" }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretBkash([{ ...validTx(), bookedAt: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on masked or invalid payer and payee telephone numbers", () => {
    expect(
      interpretBkash([{ ...validTx(), payer: { mobileNumber: "   " } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretBkash([{ ...validTx(), payer: { mobileNumber: "+88017****0001" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretBkash([{ ...validTx(), payer: { mobileNumber: "12345" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretBkash([{ ...validTx(), payer: undefined, account: undefined }], baseTxId).outcome,
    ).toBe("insufficient_evidence");

    expect(
      interpretBkash([{ ...validTx(), payee: { mobileNumber: "   " } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretBkash([{ ...validTx(), payee: { mobileNumber: "+88017••••0002" } }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretBkash([{ ...validTx(), payee: { mobileNumber: "12345" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretBkash([{ ...validTx(), payee: undefined }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });
});
