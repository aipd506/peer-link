import { describe, expect, it } from "vitest";
import { interpretMpesa } from "./transformer.js";

const VALID_INPUT = {
  account: {
    phone: "+254700000001",
    name: "Synthetic Payer Example",
  },
  transactions: [
    {
      id: "QA0000MP01",
      type: "sendMoney",
      direction: "debit",
      status: "COMPLETED",
      amount: "2500.00",
      currency: "KES",
      completedAt: "2026-10-02T16:20:00Z",
      payer: {
        phone: "+254700000001",
        name: "Synthetic Payer Example",
      },
      payee: {
        phone: "+254700000002",
        name: "Synthetic Payee Example",
      },
    },
  ],
};

describe("interpretMpesa unit tests", () => {
  it("interprets a standard completed sendMoney transaction", () => {
    const result = interpretMpesa(VALID_INPUT, "QA0000MP01");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.provider).toBe("ke/mpesa");
      expect(result.payment.amountMinor).toBe("250000");
      expect(result.payment.currency).toBe("KES");
      expect(result.payment.currencyExponent).toBe(2);
      expect(result.payment.direction).toBe("outgoing");
      expect(result.payment.status).toBe("COMPLETED");
      expect(result.payment.payer.id).toBe("+254700000001");
      expect(result.payment.payer.scheme).toBe("ke-msisdn");
      expect(result.payment.payee.id).toBe("+254700000002");
      expect(result.payment.payee.scheme).toBe("ke-msisdn");
      expect(result.payment.timestamp).toBe("2026-10-02T16:20:00Z");
      expect(result.payment.sourceAuthenticated).toBe(false);
      expect(result.payment.limitations.length).toBeGreaterThan(0);
    }
  });

  it("supports array input directly", () => {
    const arrayInput = [VALID_INPUT.transactions[0]];
    const result = interpretMpesa(arrayInput, "QA0000MP01");
    expect(result.outcome).toBe("supported");
  });

  it("supports items and data arrays in root", () => {
    const itemsInput = { items: [VALID_INPUT.transactions[0]] };
    expect(interpretMpesa(itemsInput, "QA0000MP01").outcome).toBe("supported");

    const dataInput = { data: [VALID_INPUT.transactions[0]] };
    expect(interpretMpesa(dataInput, "QA0000MP01").outcome).toBe("supported");
  });

  it("supports single object root with id or receiptNumber", () => {
    const singleRoot = structuredClone(VALID_INPUT.transactions[0]);
    expect(interpretMpesa(singleRoot, "QA0000MP01").outcome).toBe("supported");

    const receiptRoot = structuredClone(VALID_INPUT.transactions[0]);
    delete (receiptRoot as Record<string, unknown>).id;
    (receiptRoot as Record<string, unknown>).receiptNumber = "QA0000MP01";
    expect(interpretMpesa(receiptRoot, "QA0000MP01").outcome).toBe("supported");
  });

  it("supports wrapped receipt or transaction in root", () => {
    const wrappedReceipt = { receipt: VALID_INPUT.transactions[0] };
    expect(interpretMpesa(wrappedReceipt, "QA0000MP01").outcome).toBe("supported");

    const wrappedTx = { transaction: VALID_INPUT.transactions[0] };
    expect(interpretMpesa(wrappedTx, "QA0000MP01").outcome).toBe("supported");

    const wrappedReceiptNum = {
      receipt: {
        ...VALID_INPUT.transactions[0],
        id: undefined,
        receiptNumber: "QA0000MP01",
      },
    };
    expect(interpretMpesa(wrappedReceiptNum, "QA0000MP01").outcome).toBe("supported");
  });

  it("supports alternate transaction types and directions", () => {
    const types = ["send_money", "Send Money", "p2p", "P2P", "transfer"];
    for (const t of types) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].type = t;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("supported");
    }

    const outgoingDir = structuredClone(VALID_INPUT);
    outgoingDir.transactions[0].direction = "outgoing";
    expect(interpretMpesa(outgoingDir, "QA0000MP01").outcome).toBe("supported");
  });

  it("supports SUCCESS and SUCCESSFUL completed statuses", () => {
    for (const s of ["SUCCESS", "SUCCESSFUL"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = s;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("supported");
    }
  });

  it("supports timestamp and completedAt fields", () => {
    const tsInput = structuredClone(VALID_INPUT);
    delete (tsInput.transactions[0] as Record<string, unknown>).completedAt;
    (tsInput.transactions[0] as Record<string, unknown>).timestamp = "2026-10-02T16:20:00Z";
    expect(interpretMpesa(tsInput, "QA0000MP01").outcome).toBe("supported");
  });

  it("supports number amount and formatted string amount with Ksh or KES", () => {
    const numInput = structuredClone(VALID_INPUT);
    numInput.transactions[0].amount = 500 as unknown as string;
    const numResult = interpretMpesa(numInput, "QA0000MP01");
    expect(numResult.outcome).toBe("supported");
    if (numResult.outcome === "supported") {
      expect(numResult.payment.amountMinor).toBe("50000");
    }

    const kshInput = structuredClone(VALID_INPUT);
    kshInput.transactions[0].amount = "Ksh 1,234.50";
    const kshResult = interpretMpesa(kshInput, "QA0000MP01");
    expect(kshResult.outcome).toBe("supported");
    if (kshResult.outcome === "supported") {
      expect(kshResult.payment.amountMinor).toBe("123450");
    }

    const kesSuffix = structuredClone(VALID_INPUT);
    kesSuffix.transactions[0].amount = "300 KES";
    const kesResult = interpretMpesa(kesSuffix, "QA0000MP01");
    expect(kesResult.outcome).toBe("supported");
    if (kesResult.outcome === "supported") {
      expect(kesResult.payment.amountMinor).toBe("30000");
    }

    const kshSuffix = structuredClone(VALID_INPUT);
    kshSuffix.transactions[0].amount = "400.2 Ksh";
    const kshSuffixResult = interpretMpesa(kshSuffix, "QA0000MP01");
    expect(kshSuffixResult.outcome).toBe("supported");
    if (kshSuffixResult.outcome === "supported") {
      expect(kshSuffixResult.payment.amountMinor).toBe("40020");
    }
  });

  it("supports domestic Kenyan phone formats 07... and 254...", () => {
    const domesticPayer = structuredClone(VALID_INPUT);
    domesticPayer.transactions[0].payer.phone = "0700000001";
    domesticPayer.transactions[0].payee.phone = "254700000002";
    const result = interpretMpesa(domesticPayer, "QA0000MP01");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.payer.id).toBe("+254700000001");
      expect(result.payment.payee.id).toBe("+254700000002");
    }
  });

  it("supports payer fallback to account object and msisdn or id fields", () => {
    const noPayerObj = structuredClone(VALID_INPUT);
    delete (noPayerObj.transactions[0] as Record<string, unknown>).payer;
    (noPayerObj.account as Record<string, unknown>).phone = "+254700000001";
    const result1 = interpretMpesa(noPayerObj, "QA0000MP01");
    expect(result1.outcome).toBe("supported");

    const msisdnInput = structuredClone(VALID_INPUT);
    delete (msisdnInput.transactions[0].payer as Record<string, unknown>).phone;
    (msisdnInput.transactions[0].payer as Record<string, unknown>).msisdn = "+254700000001";
    delete (msisdnInput.transactions[0].payee as Record<string, unknown>).phone;
    (msisdnInput.transactions[0].payee as Record<string, unknown>).msisdn = "+254700000002";
    const result2 = interpretMpesa(msisdnInput, "QA0000MP01");
    expect(result2.outcome).toBe("supported");

    const idInput = structuredClone(VALID_INPUT);
    delete (idInput.transactions[0].payer as Record<string, unknown>).phone;
    (idInput.transactions[0].payer as Record<string, unknown>).id = "+254700000001";
    delete (idInput.transactions[0].payee as Record<string, unknown>).phone;
    (idInput.transactions[0].payee as Record<string, unknown>).id = "+254700000002";
    const result3 = interpretMpesa(idInput, "QA0000MP01");
    expect(result3.outcome).toBe("supported");
  });

  it("rejects invalid or missing transactionId parameter", () => {
    expect(interpretMpesa(VALID_INPUT, "").outcome).toBe("insufficient_evidence");
    expect(interpretMpesa(VALID_INPUT, "   ").outcome).toBe("insufficient_evidence");
    expect(interpretMpesa(VALID_INPUT, null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects invalid input envelope or missing transaction", () => {
    expect(interpretMpesa(null, "QA0000MP01").outcome).toBe("insufficient_evidence");
    expect(interpretMpesa(42, "QA0000MP01").outcome).toBe("insufficient_evidence");
    expect(interpretMpesa({}, "QA0000MP01").outcome).toBe("insufficient_evidence");
    expect(interpretMpesa(VALID_INPUT, "MISSING_ID").outcome).toBe("insufficient_evidence");
  });

  it("rejects duplicate transaction occurrences", () => {
    const dupInput = {
      transactions: [VALID_INPUT.transactions[0], VALID_INPUT.transactions[0]],
    };
    expect(interpretMpesa(dupInput, "QA0000MP01").outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for non-sendMoney types or non-outgoing direction", () => {
    const buyGoods = structuredClone(VALID_INPUT);
    buyGoods.transactions[0].type = "buyGoods";
    expect(interpretMpesa(buyGoods, "QA0000MP01").outcome).toBe("unsupported");

    const incoming = structuredClone(VALID_INPUT);
    incoming.transactions[0].direction = "credit";
    expect(interpretMpesa(incoming, "QA0000MP01").outcome).toBe("unsupported");
  });

  it("rejects pending, processing, failed, cancelled, reversed, or unknown status", () => {
    for (const status of ["PENDING", "PROCESSING"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = status;
      const res = interpretMpesa(input, "QA0000MP01");
      expect(res.outcome).toBe("insufficient_evidence");
      if (res.outcome === "insufficient_evidence") {
        expect(res.reason).toBe("Transaction is still pending execution");
      }
    }

    for (const status of ["FAILED", "CANCELLED", "REVERSED"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = status;
      const res = interpretMpesa(input, "QA0000MP01");
      expect(res.outcome).toBe("insufficient_evidence");
      if (res.outcome === "insufficient_evidence") {
        expect(res.reason).toBe("Transaction failed or was reversed");
      }
    }

    const invalidStatus = structuredClone(VALID_INPUT);
    invalidStatus.transactions[0].status = "OTHER";
    expect(interpretMpesa(invalidStatus, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const nonStringStatus = structuredClone(VALID_INPUT);
    nonStringStatus.transactions[0].status = 123 as unknown as string;
    expect(interpretMpesa(nonStringStatus, "QA0000MP01").outcome).toBe("insufficient_evidence");
  });

  it("rejects non-KES currency", () => {
    const usdInput = structuredClone(VALID_INPUT);
    usdInput.transactions[0].currency = "USD";
    expect(interpretMpesa(usdInput, "QA0000MP01").outcome).toBe("insufficient_evidence");
  });

  it("rejects non-positive numeric amounts and non-number/non-string amounts", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad as unknown as string;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("insufficient_evidence");
    }

    for (const bad of [null, undefined, true, {}, []]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad as unknown as string;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid amount strings, bad comma placement, excessive precision, or zero amounts", () => {
    const badStrings = ["abc", "1,200", "1.2.3", "50.123", "0.00", "0", "-50.00", "010.00"];
    for (const bad of badStrings) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid timestamp format and invalid calendar date", () => {
    const badDates = [
      "2026-10-02",
      "not-a-date",
      "2026-02-30T16:20:00Z",
      "2026-10-02T16:20:00+03:00",
    ];
    for (const d of badDates) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].completedAt = d;
      expect(interpretMpesa(input, "QA0000MP01").outcome).toBe("insufficient_evidence");
    }

    const nonStringDate = structuredClone(VALID_INPUT);
    nonStringDate.transactions[0].completedAt = 123456789 as unknown as string;
    expect(interpretMpesa(nonStringDate, "QA0000MP01").outcome).toBe("insufficient_evidence");
  });

  it("rejects masked or invalid payer and payee phone numbers", () => {
    const maskedPayer = structuredClone(VALID_INPUT);
    maskedPayer.transactions[0].payer.phone = "+254700***001";
    delete (maskedPayer.account as Record<string, unknown>).phone;
    expect(interpretMpesa(maskedPayer, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const badKePayer = structuredClone(VALID_INPUT);
    badKePayer.transactions[0].payer.phone = "+12345678901";
    delete (badKePayer.account as Record<string, unknown>).phone;
    expect(interpretMpesa(badKePayer, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const missingPayer = structuredClone(VALID_INPUT);
    delete (missingPayer.transactions[0] as Record<string, unknown>).payer;
    delete (missingPayer.account as Record<string, unknown>).phone;
    expect(interpretMpesa(missingPayer, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const maskedPayee = structuredClone(VALID_INPUT);
    maskedPayee.transactions[0].payee.phone = "+254700???002";
    expect(interpretMpesa(maskedPayee, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const badKePayee = structuredClone(VALID_INPUT);
    badKePayee.transactions[0].payee.phone = "12345";
    expect(interpretMpesa(badKePayee, "QA0000MP01").outcome).toBe("insufficient_evidence");

    const missingPayee = structuredClone(VALID_INPUT);
    delete (missingPayee.transactions[0] as Record<string, unknown>).payee;
    expect(interpretMpesa(missingPayee, "QA0000MP01").outcome).toBe("insufficient_evidence");
  });
});
