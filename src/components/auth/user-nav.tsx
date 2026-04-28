import Link from "next/link";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/server/auth";

function userInitial(session: {
  user?: { name?: string | null; email?: string | null };
}): string {
  const n = session.user?.name?.trim();
  if (n) return n.slice(0, 1).toUpperCase();
  const e = session.user?.email?.trim();
  if (e) return e.slice(0, 1).toUpperCase();
  return "?";
}

export async function UserNav() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-9 rounded-[10px] px-3 font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <Link href="/login">Sign in</Link>
        </Button>
        <Button
          size="sm"
          asChild
          className="h-9 rounded-[10px] px-3 font-semibold"
        >
          <Link href="/register">Register</Link>
        </Button>
      </div>
    );
  }

  const initial = userInitial(session);

  return (
    <div className="flex items-center gap-0.5">
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
        className="inline"
      >
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="h-9 rounded-[10px] px-2 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          Out
        </Button>
      </form>
      <Link
        href="/settings"
        className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff3355] to-[#ff6633] text-sm font-bold text-white shadow-[0_4px_12px_rgba(255,51,85,0.3)] transition hover:brightness-110"
        title={session.user?.email ?? "Account"}
        aria-label="Settings"
      >
        {initial}
      </Link>
    </div>
  );
}
