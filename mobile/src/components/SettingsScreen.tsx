import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Native-style settings placeholder
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Coming soon</Text>
        <Text style={styles.cardBody}>
          This tab is a placeholder so the app structure matches the
          expected native navigation layout. Settings options will be added
          here as features are implemented.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 4,
    color: "#94A3B8",
    fontSize: 14,
  },
  card: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
    backgroundColor: "#111827",
  },
  cardTitle: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "600",
  },
  cardBody: {
    marginTop: 8,
    color: "#9CA3AF",
    fontSize: 14,
    lineHeight: 20,
  },
});
