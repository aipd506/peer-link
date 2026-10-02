import { describe, expect, it } from "vitest";
import { interpretMonobank } from "./transformer.js";

describe("interpretMonobank", () => {
  const basePayerIban = "UA213220010000026007233566001";
  const basePayeeIban = "UA843052990000026008123456789";
  const baseTxId = "tx-mono-001";

  const validTx = () => ({
    id: baseTxId,
    time: 1790956800,
    mcc: 4829,
    amount: -150050,
    operationAmount: -150050,
    currencyCode: 980,
    currency: "UAH",
    direction: "debit",
    hold: false,
    status: "COMPLETED",
    completedAt: "2026-10-02T16:00:00Z",
    payer: { iban: basePayerIban },
    counterIban: basePayeeIban,
  });

  it("interprets a valid completed domestic IBAN transfer from array input", () => {
    const res = interpretMonobank([validTx()], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.amountMinor).toBe("150050");
      expect(res.payment.currency).toBe("UAH");
      expect(res.payment.payer.id).toBe(basePayerIban);
      expect(res.payment.payee.id).toBe(basePayeeIban);
      expect(res.payment.status).toBe("COMPLETED");
    }
  });

  it("interprets input from statement, items, data, or single object envelope", () => {
    const tx = validTx();
    expect(interpretMonobank({ statement: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank({ items: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank({ data: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank({ transactions: [tx] }, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank(tx, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank({ receipt: tx }, baseTxId).outcome).toBe("supported");
    expect(interpretMonobank({ transaction: tx }, baseTxId).outcome).toBe("supported");

    const receiptWithReceiptId = { ...tx, id: undefined, receiptId: "rcpt-001" };
    expect(interpretMonobank(receiptWithReceiptId, "rcpt-001").outcome).toBe("supported");
    expect(interpretMonobank({ receipt: receiptWithReceiptId }, "rcpt-001").outcome).toBe(
      "supported",
    );
  });

  it("handles alternative card and client id identifiers for payer and payee", () => {
    const txCard = {
      ...validTx(),
      payer: { cardNumber: "4149490000001111" },
      counterIban: undefined,
      payee: { cardNumber: "5168740000002222" },
    };
    const resCard = interpretMonobank([txCard], baseTxId);
    expect(resCard.outcome).toBe("supported");
    if (resCard.outcome === "supported") {
      expect(resCard.payment.payer.scheme).toBe("pan");
      expect(resCard.payment.payer.id).toBe("4149490000001111");
      expect(resCard.payment.payee.scheme).toBe("pan");
      expect(resCard.payment.payee.id).toBe("5168740000002222");
    }

    const txCardAlt = {
      ...validTx(),
      payer: { card: "4149490000001111" },
      counterIban: undefined,
      payee: { card: "5168740000002222" },
    };
    const resCardAlt = interpretMonobank([txCardAlt], baseTxId);
    expect(resCardAlt.outcome).toBe("supported");

    const txClient = {
      ...validTx(),
      account: { id: "client-acc-999", iban: undefined },
      payer: undefined,
      counterIban: undefined,
      payee: { id: "dest-acc-888" },
    };
    const resClient = interpretMonobank([txClient], baseTxId);
    expect(resClient.outcome).toBe("supported");
    if (resClient.outcome === "supported") {
      expect(resClient.payment.payer.scheme).toBe("ua-monobank-account");
      expect(resClient.payment.payer.id).toBe("client-acc-999");
      expect(resClient.payment.payee.scheme).toBe("ua-monobank-account");
      expect(resClient.payment.payee.id).toBe("dest-acc-888");
    }

    const txCounterCard = {
      ...validTx(),
      counterIban: undefined,
      counterCardNumber: "4149490000003333",
    };
    const resCounterCard = interpretMonobank([txCounterCard], baseTxId);
    expect(resCounterCard.outcome).toBe("supported");
    if (resCounterCard.outcome === "supported") {
      expect(resCounterCard.payment.payee.scheme).toBe("pan");
      expect(resCounterCard.payment.payee.id).toBe("4149490000003333");
    }
  });

  it("handles status resolution with hold: false and omitted status or alternative confirmed statuses", () => {
    const txNoStatus = { ...validTx(), status: undefined, hold: false };
    const res = interpretMonobank([txNoStatus], baseTxId);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.status).toBe("COMPLETED");
    }

    const txSettled = { ...validTx(), status: "SETTLED" };
    expect(interpretMonobank([txSettled], baseTxId).outcome).toBe("supported");
    const txConfirmed = { ...validTx(), status: "CONFIRMED" };
    expect(interpretMonobank([txConfirmed], baseTxId).outcome).toBe("supported");
  });

  it("handles amounts as float, decimal string with commas or dots, and currency symbols", () => {
    const txFloat = { ...validTx(), amount: -1500.5 };
    const resFloat = interpretMonobank([txFloat], baseTxId);
    expect(resFloat.outcome).toBe("supported");
    if (resFloat.outcome === "supported") {
      expect(resFloat.payment.amountMinor).toBe("150050");
    }

    const txStringDot = { ...validTx(), amount: "UAH 1500.50" };
    const resDot = interpretMonobank([txStringDot], baseTxId);
    expect(resDot.outcome).toBe("supported");
    if (resDot.outcome === "supported") {
      expect(resDot.payment.amountMinor).toBe("150050");
    }

    const txStringComma = { ...validTx(), amount: "-1500,50 грн" };
    const resComma = interpretMonobank([txStringComma], baseTxId);
    expect(resComma.outcome).toBe("supported");
    if (resComma.outcome === "supported") {
      expect(resComma.payment.amountMinor).toBe("150050");
    }

    const txIntegerString = { ...validTx(), amount: "2000" };
    const resInt = interpretMonobank([txIntegerString], baseTxId);
    expect(resInt.outcome).toBe("supported");
    if (resInt.outcome === "supported") {
      expect(resInt.payment.amountMinor).toBe("200000");
    }
  });

  it("handles numeric timestamps in seconds or milliseconds", () => {
    const txSec = { ...validTx(), completedAt: undefined, timestamp: undefined, time: 1790956800 };
    const resSec = interpretMonobank([txSec], baseTxId);
    expect(resSec.outcome).toBe("supported");
    if (resSec.outcome === "supported") {
      expect(resSec.payment.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }

    const txMs = {
      ...validTx(),
      completedAt: undefined,
      timestamp: undefined,
      time: 1790956800000,
    };
    const resMs = interpretMonobank([txMs], baseTxId);
    expect(resMs.outcome).toBe("supported");
  });

  it("rejects invalid, missing, or blank transaction id", () => {
    expect(interpretMonobank([validTx()], "").outcome).toBe("insufficient_evidence");
    expect(interpretMonobank([validTx()], "   ").outcome).toBe("insufficient_evidence");
    expect(interpretMonobank([validTx()], null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects non-array/non-object input or empty transaction list", () => {
    expect(interpretMonobank(null, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretMonobank("invalid", baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretMonobank({}, baseTxId).outcome).toBe("insufficient_evidence");
    expect(interpretMonobank([], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("rejects absent or duplicate transaction rows", () => {
    const tx = validTx();
    expect(interpretMonobank([tx], "different-id").outcome).toBe("insufficient_evidence");
    expect(interpretMonobank([tx, tx], baseTxId).outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for excluded categories and incoming directions", () => {
    expect(interpretMonobank([{ ...validTx(), isMerchant: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), isUtility: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), isMobileTopup: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), isCashWithdrawal: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), isJar: true }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), mcc: 5411 }], baseTxId).outcome).toBe("unsupported");
    expect(interpretMonobank([{ ...validTx(), direction: "incoming" }], baseTxId).outcome).toBe(
      "unsupported",
    );
    expect(interpretMonobank([{ ...validTx(), direction: "credit" }], baseTxId).outcome).toBe(
      "unsupported",
    );
  });

  it("fails closed on pending, processing, failed, reversed, or cancelled status", () => {
    expect(interpretMonobank([{ ...validTx(), hold: true }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "PENDING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "PROCESSING" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "FAILED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "CANCELLED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "REVERSED" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), status: "UNKNOWN" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretMonobank([{ ...validTx(), status: undefined, hold: undefined }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
  });

  it("fails closed on conflicting or unsupported currency", () => {
    expect(
      interpretMonobank([{ ...validTx(), currency: "USD", currencyCode: 840 }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), currency: undefined, currencyCode: undefined }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), currency: undefined, currencyCode: "980" }], baseTxId)
        .outcome,
    ).toBe("supported");
  });

  it("fails closed on invalid amounts", () => {
    expect(interpretMonobank([{ ...validTx(), amount: 0 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: Number.NaN }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: -1500.555 }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: "+1500.50" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: "1500,555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: "1500.555" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: "abc" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: true }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(interpretMonobank([{ ...validTx(), amount: "0.00" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("fails closed on invalid timestamps", () => {
    expect(interpretMonobank([{ ...validTx(), completedAt: "not-a-date" }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretMonobank([{ ...validTx(), completedAt: "2026-02-31T16:00:00Z" }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), completedAt: undefined, time: 0 }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), completedAt: undefined, time: undefined }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
  });

  it("fails closed on masked or invalid payer and payee identifiers", () => {
    expect(
      interpretMonobank([{ ...validTx(), payer: { cardNumber: "   " } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(interpretMonobank([{ ...validTx(), payer: { iban: "   " } }], baseTxId).outcome).toBe(
      "insufficient_evidence",
    );
    expect(
      interpretMonobank([{ ...validTx(), payer: { cardNumber: "12345" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank(
        [{ ...validTx(), payer: { iban: "UA213220010000026****33566001" } }],
        baseTxId,
      ).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), payer: { iban: "INVALID_IBAN" } }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), payer: undefined, account: undefined }], baseTxId).outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), counterIban: "UA843052990000026••••123456789" }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank([{ ...validTx(), counterIban: undefined, payee: undefined }], baseTxId)
        .outcome,
    ).toBe("insufficient_evidence");
    expect(
      interpretMonobank(
        [{ ...validTx(), counterIban: undefined, payee: { id: "masked*id" } }],
        baseTxId,
      ).outcome,
    ).toBe("insufficient_evidence");
  });
});
