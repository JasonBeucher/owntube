import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FriendsPanel } from "@/components/friends/friends-panel";
import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/server/auth";

export const metadata: Metadata = {
  title: "Friends",
};

export default async function FriendsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/friends");
  }

  return (
    <main className="ot-page max-w-4xl space-y-6">
      <PageHeader
        title="Friends"
        subtitle="Send videos to people on this instance — everything stays on your server."
      />
      <FriendsPanel />
    </main>
  );
}
