import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Court } from "@gaze/types";

type Props = {
  court: Court;
};

function formatRelativeTime(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) return null;

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  const diffMs = Date.now() - parsed.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function getStatusMeta(status: Court["status"]) {
  switch (status) {
    case "available":
      return { label: "Available", color: "#22C55E" };
    case "occupied":
      return { label: "Occupied", color: "#EF4444" };
    case "unknown":
    default:
      return { label: "Unknown", color: "#9CA3AF" };
  }
}

export default function CourtRow({ court }: Props) {
  const status = getStatusMeta(court.status);
  const relative = formatRelativeTime(court.last_updated);

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: status.color }]} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{court.name}</Text>
        <Text style={styles.subtitle}>{status.label}</Text>
      </View>
      {relative ? <Text style={styles.timestamp}>{relative}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
    backgroundColor: "#0B1220",
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F9FAFB",
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: "#9CA3AF",
  },
  timestamp: {
    marginLeft: 8,
    fontSize: 12,
    color: "#6B7280",
  },
});
