"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveSignInOutcome } from "@/lib/sign-in-result";

export function LoginForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
          callbackUrl,
        });
        setLoading(false);
        const outcome = resolveSignInOutcome(result, callbackUrl);
        if (outcome.status === "success") {
          window.location.href = outcome.destination;
          return;
        }
        setError("Invalid credentials.");
      }}
    >
      <Input type="email" name="email" placeholder="you@example.com" required />
      <Input type="password" name="password" placeholder="Password" required />
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
