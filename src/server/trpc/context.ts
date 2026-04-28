import { auth } from "@/server/auth";
import { type AppDb, getDb } from "@/server/db/client";

export type TRPCContext = {
  db: AppDb;
  userId: number | null;
};

export async function createTRPCContext(): Promise<TRPCContext> {
  const session = await auth();
  const parsedId = session?.user?.id
    ? Number.parseInt(session.user.id, 10)
    : NaN;
  return {
    db: getDb(),
    userId: Number.isFinite(parsedId) ? parsedId : null,
  };
}
