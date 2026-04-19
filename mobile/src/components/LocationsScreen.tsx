import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Location } from "@gaze/types";

type Props = {
  locations: Location[];
  selectedLocationId: string | null;
  loading?: boolean;
  refreshing?: boolean;
  errorMessage?: string | null;
  onSelectLocation: (location: Location) => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  headerTitle?: string;
};

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function EmptyState({
  loading,
  errorMessage,
  onRetry,
}: {
  loading: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color="#60A5FA" />
        <Text style={styles.subtle}>Loading locations…</Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorTitle}>Couldn’t load locations</Text>
        <Text style={styles.subtle}>{errorMessage}</Text>
        {onRetry ? (
          <Pressable style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.subtle}>No locations available.</Text>
    </View>
  );
}

export default function LocationsScreen({
  locations,
  selectedLocationId,
  loading = false,
  refreshing = false,
  errorMessage = null,
  onSelectLocation,
  onRefresh,
  onRetry,
  headerTitle = "Locations",
}: Props) {
  const showEmpty = locations.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{headerTitle}</Text>
      </View>

      {showEmpty ? (
        <EmptyState loading={loading} errorMessage={errorMessage} onRetry={onRetry} />
      ) : (
        <FlatList
          data={locations}
          keyExtractor={(item) => item.id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const selected = selectedLocationId === item.id;
            return (
              <Pressable
                onPress={() => onSelectLocation(item)}
                style={[styles.item, selected && styles.itemSelected]}
              >
                <View style={styles.itemTextWrap}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>
                    {formatCoords(item.latitude, item.longitude)}
                  </Text>
                </View>
                <Text style={[styles.chevron, selected && styles.chevronSelected]}>
                  {selected ? "✓" : "›"}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
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
    fontSize: 24,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderColor: "#1F2937",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginVertical: 6,
  },
  itemSelected: {
    borderColor: "#3B82F6",
    backgroundColor: "#0F172A",
  },
  itemTextWrap: {
    flex: 1,
  },
  itemName: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "600",
  },
  itemMeta: {
    marginTop: 2,
    color: "#94A3B8",
    fontSize: 13,
  },
  chevron: {
    marginLeft: 10,
    color: "#6B7280",
    fontSize: 22,
    fontWeight: "700",
  },
  chevronSelected: {
    color: "#60A5FA",
    fontSize: 18,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  subtle: {
    color: "#94A3B8",
    textAlign: "center",
  },
  errorTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "600",
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: "#2563EB",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
