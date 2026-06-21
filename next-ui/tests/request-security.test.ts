import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { hostHeaderHostname, requestHostAllowed, validateRlabRequest } from "../src/server/request-security";

function req(headers: IncomingMessage["headers"], method = "GET"): IncomingMessage {
  return { headers, method } as IncomingMessage;
}

describe("request security guard", () => {
  it("allows loopback hosts by default", () => {
    expect(requestHostAllowed("localhost:5187", {})).toBe(true);
    expect(requestHostAllowed("127.0.0.1:5187", {})).toBe(true);
    expect(requestHostAllowed("[::1]:5187", {})).toBe(true);
  });

  it("requires explicit allowed hosts for non-loopback hosts", () => {
    expect(requestHostAllowed("rlab.example.test", {})).toBe(false);
    expect(requestHostAllowed("rlab.example.test", { RLAB_ALLOWED_HOSTS: "rlab.example.test" })).toBe(true);
  });

  it("rejects missing and cross-origin browser requests", () => {
    expect(validateRlabRequest(req({}))).toEqual({ statusCode: 400, message: "Host header is required." });
    expect(validateRlabRequest(req({ host: "localhost:5187", origin: "https://evil.example" }, "POST"))).toEqual({
      statusCode: 403,
      message: "Cross-origin requests are not allowed.",
    });
    expect(validateRlabRequest(req({ host: "localhost:5187", "sec-fetch-site": "cross-site" }, "POST"))).toEqual({
      statusCode: 403,
      message: "Cross-site requests are not allowed.",
    });
  });

  it("normalizes host headers without trusting ports", () => {
    expect(hostHeaderHostname("RLab.Example.Test:443")).toBe("rlab.example.test");
    expect(hostHeaderHostname("[::1]:5187")).toBe("::1");
  });
});
