import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { TakeoutImportPanel } from "@/components/settings/takeout-import-panel";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings");
  }

  const caller = await createCaller();
  const settings = await caller.settings.get();

  return (
    <main className="ot-page max-w-4xl space-y-8">
      <PageHeader
        title="Settings"
        subtitle="Instance URL, theme, and account preferences."
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Home</Link>
        </Button>
      </PageHeader>
      <SettingsPanel initial={settings} />
      <TakeoutImportPanel />
    </main>
  );
}
