import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type BottomTabKey = "locations" | "courts" | "settings";

export type BottomTabItem = {
  key: BottomTabKey;
  label: string;
  icon?: string;
};

export type BottomNavProps = {
  activeTab: BottomTabKey;
  onChange: (tab: BottomTabKey) => void;
  tabs?: BottomTabItem[];
};

const DEFAULT_TABS: BottomTabItem[] = [
  { key: "locations", label: "Locations", icon: "📍" },
  { key: "courts", label: "Courts", icon: "🎾" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

export default function BottomNav({
  activeTab,
  onChange,
  tabs = DEFAULT_TABS,
}: BottomNavProps) {
  return (
    <View style={styles.outerWrap}>
      <View style={styles.navContainer}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [
                styles.tabButton,
                isActive && styles.tabButtonActive,
                pressed && styles.tabButtonPressed,
              ]}
            >
              {tab.icon ? (
                <Text style={[styles.icon, isActive && styles.iconActive]}>
                  {tab.icon}
                </Text>
              ) : null}
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1F2937",
    backgroundColor: "#0B1220",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  navContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#111827",
    borderColor: "#1F2937",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    marginHorizontal: 2,
  },
  tabButtonActive: {
    backgroundColor: "#1D4ED8",
  },
  tabButtonPressed: {
    opacity: 0.8,
  },
  icon: {
    fontSize: 15,
    color: "#9CA3AF",
  },
  iconActive: {
    color: "#FFFFFF",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9CA3AF",
  },
  labelActive: {
    color: "#FFFFFF",
  },
});
