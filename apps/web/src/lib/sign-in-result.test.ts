import { describe, expect, it } from "vitest";
import { resolveSignInOutcome } from "@/lib/sign-in-result";

describe("resolveSignInOutcome", () => {
  it("treats a rejected credential check as a failure even though ok is true", () => {
    // next-auth v5 answers 200 for a bad password: ok=true, error set, url null.
    expect(
      resolveSignInOutcome({
        error: "CredentialsSignin",
        ok: true,
        url: null,
      }),
    ).toEqual({ status: "failed" });
  });

  it("fails on a missing or unsuccessful result", () => {
    expect(resolveSignInOutcome(undefined)).toEqual({ status: "failed" });
    expect(resolveSignInOutcome(null)).toEqual({ status: "failed" });
    expect(resolveSignInOutcome({ ok: false })).toEqual({ status: "failed" });
  });

  it("keeps only the path so the session cookie's origin is preserved", () => {
    expect(
      resolveSignInOutcome({ ok: true, url: "http://localhost:3000/settings" }),
    ).toEqual({ status: "success", destination: "/settings" });
    expect(
      resolveSignInOutcome({
        ok: true,
        url: "http://192.168.1.20:3000/?tab=1",
      }),
    ).toEqual({ status: "success", destination: "/?tab=1" });
  });

  it("falls back when the URL is absent or unparseable", () => {
    expect(resolveSignInOutcome({ ok: true })).toEqual({
      status: "success",
      destination: "/",
    });
    expect(resolveSignInOutcome({ ok: true }, "/onboarding/taste")).toEqual({
      status: "success",
      destination: "/onboarding/taste",
    });
    expect(resolveSignInOutcome({ ok: true, url: "not a url" })).toEqual({
      status: "success",
      destination: "/",
    });
    expect(resolveSignInOutcome({ ok: true, url: "/history" })).toEqual({
      status: "success",
      destination: "/history",
    });
  });
});
