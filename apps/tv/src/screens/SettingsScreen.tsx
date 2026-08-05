import type { SponsorBlockCategory } from "@web/lib/sponsorblock";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { FocusableTextInput } from "@/components/focusable-text-input";
import { getBaseUrl, setBaseUrl } from "@/lib/config";
import { trpcClient } from "@/lib/trpc";
import { useQuery } from "@/lib/use-query";
import { colors, fontSize, monoFont, radius, spacing } from "@/theme";

const QUALITY_OPTIONS = ["best", "1080p", "720p", "480p", "360p"] as const;
const REGION_OPTIONS = ["US", "GB", "FR", "DE", "CA", "JP"] as const;

/**
 * Per-user preferences read from and written back to the server, plus the
 * device-local instance URL (which cannot live server-side — it is how the
 * device finds the server in the first place).
 */
export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const settings = useQuery(() => trpcClient.settings.get.query(), []);
  const [instanceUrl, setInstanceUrl] = useState(getBaseUrl());
  const [instanceNote, setInstanceNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = (
    patch: Parameters<typeof trpcClient.settings.update.mutate>[0],
  ) => {
    setSaving(true);
    trpcClient.settings.update
      .mutate(patch)
      .then(() => settings.refetch())
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  const saveInstance = () => {
    setBaseUrl(instanceUrl)
      .then((normalized) => {
        setInstanceUrl(normalized);
        setInstanceNote("Saved. Restart the app if data looks stale.");
        settings.refetch();
      })
      .catch(() => setInstanceNote("Could not save that URL."));
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Settings</Text>

      <Section title="Instance">
        <Text style={styles.hint}>The owntube server this TV talks to.</Text>
        <View style={styles.row}>
          <FocusableTextInput
            placeholder="http://192.168.1.10:3000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={instanceUrl}
            onChangeText={(next) => {
              setInstanceUrl(next);
              setInstanceNote(null);
            }}
            onSubmitEditing={saveInstance}
            returnKeyType="done"
            containerStyle={styles.grow}
          />
          <FocusButton
            label="Save"
            variant="primary"
            onPress={saveInstance}
            style={styles.actionButton}
          />
        </View>
        {instanceNote ? <Text style={styles.note}>{instanceNote}</Text> : null}
      </Section>

      {settings.status === "loading" ? (
        <ActivityIndicator color={colors.brand} />
      ) : settings.status === "error" ? (
        <Section title="Preferences">
          <Text style={styles.hint}>{settings.message}</Text>
          <FocusButton
            label="Retry"
            onPress={settings.refetch}
            style={styles.actionButton}
          />
        </Section>
      ) : (
        <>
          <Section title="Playback quality">
            <ChoiceRow
              options={QUALITY_OPTIONS}
              selected={settings.data.defaultPlaybackQuality}
              disabled={saving}
              onSelect={(value) => save({ defaultPlaybackQuality: value })}
            />
          </Section>

          <Section title="Trending region">
            <ChoiceRow
              options={REGION_OPTIONS}
              selected={settings.data.trendingRegion}
              disabled={saving}
              onSelect={(value) => save({ trendingRegion: value })}
            />
          </Section>

          <Section title="SponsorBlock">
            <ChoiceRow
              options={["On", "Off"] as const}
              selected={settings.data.sponsorBlockEnabled ? "On" : "Off"}
              disabled={saving}
              onSelect={(value) =>
                save({ sponsorBlockEnabled: value === "On" })
              }
            />
            <Text style={styles.hint}>
              Skipping {formatCategories(settings.data.sponsorBlockCategories)}.
            </Text>
          </Section>

          <Section title="Restricted videos">
            <ChoiceRow
              options={["Hide", "Show"] as const}
              selected={settings.data.hideRestrictedVideos ? "Hide" : "Show"}
              disabled={saving}
              onSelect={(value) =>
                save({ hideRestrictedVideos: value === "Hide" })
              }
            />
          </Section>
        </>
      )}

      <Section title="Account">
        <FocusButton
          label="Sign out"
          onPress={onSignOut}
          style={styles.actionButton}
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChoiceRow<T extends string>({
  options,
  selected,
  disabled,
  onSelect,
}: {
  options: readonly T[];
  selected: string;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((option) => (
        <FocusButton
          key={option}
          label={option}
          variant={option === selected ? "primary" : "ghost"}
          disabled={disabled}
          onPress={() => onSelect(option)}
          style={styles.choiceButton}
        />
      ))}
    </View>
  );
}

function formatCategories(categories: SponsorBlockCategory[]): string {
  if (categories.length === 0) return "nothing";
  return categories.join(", ");
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.screen },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  section: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
  choiceButton: { minWidth: 130 },
  actionButton: { minWidth: 190, alignSelf: "flex-start" },
  hint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  note: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontFamily: monoFont,
  },
});
