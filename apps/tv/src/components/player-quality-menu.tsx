import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

export type PlayerQualityOption = {
  id: string;
  label: string;
};

type PlayerQualityMenuProps = {
  open: boolean;
  options: PlayerQualityOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Menu heading — also used for the subtitle track picker. */
  title?: string;
  icon?: "settings" | "message-square";
};

export function PlayerQualityMenu({
  open,
  options,
  selectedIndex,
  onSelect,
  title = "Quality",
  icon = "settings",
}: PlayerQualityMenuProps) {
  if (!open || options.length === 0) return null;

  return (
    <View style={styles.menu}>
      <View style={styles.header}>
        <Feather name={icon} size={18} color={colors.brand} />
        <Text style={styles.headerText}>{title}</Text>
      </View>
      <View style={styles.list}>
        {options.map((option, index) => (
          <QualityMenuItem
            key={option.id}
            label={option.label}
            selected={index === selectedIndex}
            hasTVPreferredFocus={index === selectedIndex}
            onPress={() => onSelect(index)}
          />
        ))}
      </View>
    </View>
  );
}

function QualityMenuItem({
  label,
  selected,
  hasTVPreferredFocus,
  onPress,
}: {
  label: string;
  selected: boolean;
  hasTVPreferredFocus: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.item,
        selected && styles.itemSelected,
        focused && styles.itemFocused,
      ]}
    >
      <Text
        style={[
          styles.itemText,
          selected && styles.itemTextSelected,
          focused && styles.itemTextFocused,
        ]}
      >
        {label}
      </Text>
      {selected ? (
        <Feather
          name="check"
          size={20}
          color={focused ? colors.primaryForeground : colors.brand}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    right: 0,
    bottom: 132,
    width: 260,
    maxHeight: 360,
    padding: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
    shadowColor: colors.shadow,
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
    zIndex: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  headerText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "800",
  },
  list: {
    paddingTop: spacing.xs,
    gap: 4,
  },
  item: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  itemSelected: {
    backgroundColor: colors.brandSofter,
  },
  itemFocused: {
    borderColor: colors.primaryForeground,
    backgroundColor: colors.brand,
    transform: [{ scale: focus.scale }],
  },
  itemText: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  itemTextSelected: {
    color: colors.brand,
  },
  itemTextFocused: {
    color: colors.primaryForeground,
  },
});
