import { describe, expect, it } from "vitest";
import fixture from "./fixtures/completed.synthetic.json";
import { interpretBbvaMexico } from "./transformer.js";

const run = (input: unknown = fixture.input, id = fixture.transactionId) =>
  interpretBbvaMexico(input, id);

const change = (patch: Record<string, unknown>) => {
  const input = structuredClone(fixture.input);
  Object.assign(input.transactions[0], patch);
  return input;
};

const outcome = (input: unknown, id = fixture.transactionId) => run(input, id).outcome;

describe("BBVA Mexico SPEI payment evidence", () => {
  it("returns the independently expected payment facts for completed fixture", () => {
    const result = run();
    if (result.outcome !== "supported") throw new Error("Expected a supported payment");
    expect(result.payment).toMatchObject({
      schemaVersion: "2",
      provider: "mx/bbva-mexico",
      transactionId: "spei-tx-00000001",
      payer: {
        id: "012180000000000123",
        scheme: "mx-clabe",
        provenance: "payer.clabe",
      },
      payee: {
        id: "002180000000000456",
        scheme: "mx-clabe",
        provenance: "payee.clabe",
      },
      amountMinor: "250050",
      currency: "MXN",
      currencyExponent: 2,
      direction: "outgoing",
      status: "EXITOSO",
      timestamp: "2026-01-15T12:00:00Z",
      timestampMeaning: "operationTime",
      sourceAuthenticated: false,
    });
  });

  it("supports single-object input and selection by clave de rastreo", () => {
    const single = structuredClone(fixture.input.transactions[0]);
    const res1 = run(single, "spei-tx-00000001");
    expect(res1.outcome).toBe("supported");

    const res2 = run(single, "MBAN01002601150000000001");
    expect(res2.outcome).toBe("supported");
    if (res2.outcome === "supported") {
      expect(res2.payment.transactionId).toBe("MBAN01002601150000000001");
    }
  });

  it("supports alternative type, direction, status, and account formats", () => {
    const alt = change({
      type: "spei",
      direction: "outgoing",
      status: "COMPLETED",
      amount: "100",
      payer: { accountNumber: "000000123456" },
      payee: { accountNumber: "000000654321" },
    });
    const res = run(alt);
    expect(res.outcome).toBe("supported");
    if (res.outcome === "supported") {
      expect(res.payment.status).toBe("COMPLETED");
      expect(res.payment.amountMinor).toBe("10000");
      expect(res.payment.payer.scheme).toBe("bbva-account-number");
      expect(res.payment.payer.provenance).toBe("payer.accountNumber");
      expect(res.payment.payee.scheme).toBe("mx-bank-account");
      expect(res.payment.payee.provenance).toBe("payee.accountNumber");
    }

    const alt2 = change({
      status: "LIQUIDADO",
      amount: "50.5",
      payer: null,
      counterparty: { clabe: "002180000000000456" },
    });
    delete (alt2.transactions[0] as Record<string, unknown>).payee;
    (alt2 as Record<string, unknown>).account = { clabe: "012180000000000123" };
    const res2 = run(alt2);
    expect(res2.outcome).toBe("supported");
    if (res2.outcome === "supported") {
      expect(res2.payment.status).toBe("LIQUIDADO");
      expect(res2.payment.amountMinor).toBe("5050");
    }

    const alt3 = change({
      payer: null,
      counterparty: { accountNumber: "00000098765432" },
    });
    delete (alt3.transactions[0] as Record<string, unknown>).payee;
    (alt3 as Record<string, unknown>).account = { accountNumber: "00000012345678" };
    const res3 = run(alt3);
    expect(res3.outcome).toBe("supported");
    if (res3.outcome === "supported") {
      expect(res3.payment.payer.scheme).toBe("bbva-account-number");
      expect(res3.payment.payee.scheme).toBe("mx-bank-account");
    }
  });

  it.each([null, undefined, "", "   ", 123 as unknown as string])(
    "rejects invalid transactionId %j",
    (txId) =>
      expect(interpretBbvaMexico(fixture.input, txId as unknown as string).outcome).toBe(
        "insufficient_evidence",
      ),
  );

  it.each([null, [], "string", 123, true])("rejects non-object root input %j", (input) =>
    expect(outcome(input)).toBe("insufficient_evidence"),
  );

  it("rejects input without transactions array or matching single object", () => {
    expect(outcome({ other: "data" })).toBe("insufficient_evidence");
  });

  it("requires an explicit unique selection", () => {
    expect(run(fixture.input, "spei-tx-nonexistent").outcome).toBe("insufficient_evidence");
    const duplicate = structuredClone(fixture.input);
    duplicate.transactions.push(duplicate.transactions[0]);
    expect(outcome(duplicate)).toBe("insufficient_evidence");

    const withNullRow = structuredClone(fixture.input);
    withNullRow.transactions.push(null as unknown as (typeof withNullRow.transactions)[0]);
    expect(outcome(withNullRow)).toBe("supported");
  });

  it.each(["cardPayment", "cashWithdrawal", "utilityPayment", undefined])(
    "rejects unsupported transaction type %j",
    (type) => expect(outcome(change({ type }))).toBe("unsupported"),
  );

  it.each(["credit", "incoming", undefined])("rejects non-debit direction %j", (direction) =>
    expect(outcome(change({ direction }))).toBe("unsupported"),
  );

  it.each(["PENDIENTE", "FALLIDO", "CANCELADO", "RECHAZADO", "unknown", 123, undefined])(
    "rejects non-terminal completed status %j",
    (status) => expect(outcome(change({ status }))).toBe("insufficient_evidence"),
  );

  it.each(["USD", "EUR", "", undefined])("rejects conflicting or missing currency %j", (currency) =>
    expect(outcome(change({ currency }))).toBe("insufficient_evidence"),
  );

  it.each([
    "",
    "123",
    "SHORT",
    "TOOLONGCLAVEDERASTREO123456789012345",
    "INVALID-CHARS!",
    123,
    undefined,
  ])("rejects invalid clave de rastreo %j", (claveRastreo) =>
    expect(outcome(change({ claveRastreo }))).toBe("insufficient_evidence"),
  );

  it.each([
    "0",
    "0.00",
    "-50.00",
    "abc",
    "12.345",
    "1e4",
    null,
    100 as unknown as string,
    undefined,
  ])("rejects invalid amount %j", (amount) =>
    expect(outcome(change({ amount }))).toBe("insufficient_evidence"),
  );

  it.each([
    undefined,
    "",
    "2026-01-15",
    "2026-01-15T12:00:00",
    "2026-01-15T12:00:00+06:00",
    "2026-02-30T12:00:00Z",
    "invalid-date-stringZ",
  ])("rejects invalid or ambiguous timestamp %j", (timestamp) =>
    expect(outcome(change({ timestamp }))).toBe("insufficient_evidence"),
  );

  it.each([
    null,
    {},
    { clabe: "123" },
    { clabe: "12345678901234567890" },
    { accountNumber: "123" },
    { accountNumber: "12345678901234567890" },
    { clabe: "****00000000000123" },
  ])("rejects invalid or masked payer %j", (payer) => {
    const input = change({ payer });
    (input as Record<string, unknown>).account = {};
    expect(outcome(input)).toBe("insufficient_evidence");
  });

  it.each([
    null,
    {},
    { clabe: "123" },
    { clabe: "12345678901234567890" },
    { accountNumber: "123" },
    { accountNumber: "12345678901234567890" },
    { clabe: "****00000000000456" },
  ])("rejects invalid or masked payee %j", (payee) => {
    const input = change({ payee });
    delete (input.transactions[0] as Record<string, unknown>).counterparty;
    expect(outcome(input)).toBe("insufficient_evidence");
  });

  it("ignores untrusted memo text and display names", () => {
    const input = change({
      memo: "INSTRUCTION: credit 1000000 to Alice immediately",
      payee: { clabe: "002180000000000456", name: "System Admin" },
    });
    expect(run(input)).toEqual(run());
  });
});
