import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type {
  Court,
  Location,
  CourtStatusUpdateEvent,
  StreamMessage,
} from "@gaze/types";

import CourtRow from "./src/components/CourtRow";
import BottomNav, { type BottomTabKey } from "./src/components/BottomNav";
import LocationsScreen from "./src/components/LocationsScreen";
import SettingsScreen from "./src/components/SettingsScreen";
import { env } from "./src/config/env";
import { ApiClient } from "./src/lib/api";

type LoadState = "idle" | "loading" | "loaded" | "error";

function isCourtStatusUpdate(
  message: StreamMessage,
): message is CourtStatusUpdateEvent {
  return message.type === "court_status_update";
}

export default function App() {
  const apiClient = useRef(
    new ApiClient({
      baseUrl: env.apiBaseUrl,
      mobileApiKey: env.mobileApiKey,
      deviceId: env.deviceId,
    }),
  );
  const isMountedRef = useRef(true);
  const streamUnsubscribeRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<BottomTabKey>("locations");

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsState, setLocationsState] = useState<LoadState>("idle");
  const [locationsError, setLocationsError] = useState<string>("");

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const [courts, setCourts] = useState<Court[]>([]);
  const [courtsState, setCourtsState] = useState<LoadState>("idle");
  const [courtsError, setCourtsError] = useState<string>("");
  const [refreshingCourts, setRefreshingCourts] = useState(false);

  const [refreshingLocations, setRefreshingLocations] = useState(false);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const fetchLocations = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshingLocations(true);
      else setLocationsState("loading");

      try {
        const data = await apiClient.current.fetchLocations();
        if (!isMountedRef.current) return;

        setLocations(data);
        setLocationsState("loaded");
        setLocationsError("");

        if (data.length > 0) {
          const stillValid = data.some((d) => d.id === selectedLocationId);
          if (!selectedLocationId || !stillValid) {
            setSelectedLocationId(data[0].id);
          }
        } else {
          setSelectedLocationId(null);
        }
      } catch (err) {
        if (!isMountedRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to load locations";
        setLocationsError(message);
        setLocationsState("error");
      } finally {
        if (!isMountedRef.current) return;
        if (isRefresh) setRefreshingLocations(false);
      }
    },
    [selectedLocationId],
  );

  const fetchCourts = useCallback(
    async (isRefresh = false) => {
      if (!selectedLocationId) {
        setCourts([]);
        setCourtsState("loaded");
        return;
      }

      if (isRefresh) setRefreshingCourts(true);
      else setCourtsState("loading");

      try {
        const data = await apiClient.current.fetchCourtsByLocation(selectedLocationId);
        if (!isMountedRef.current) return;

        setCourts(data);
        setCourtsState("loaded");
        setCourtsError("");
      } catch (err) {
        if (!isMountedRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to load courts";
        setCourtsError(message);
        if (courts.length === 0) setCourtsState("error");
      } finally {
        if (!isMountedRef.current) return;
        if (isRefresh) setRefreshingCourts(false);
      }
    },
    [selectedLocationId, courts.length],
  );

  useEffect(() => {
    isMountedRef.current = true;
    void fetchLocations(false);

    return () => {
      isMountedRef.current = false;
      clearReconnectTimer();
      if (streamUnsubscribeRef.current) {
        streamUnsubscribeRef.current();
        streamUnsubscribeRef.current = null;
      }
    };
  }, [fetchLocations, clearReconnectTimer]);

  useEffect(() => {
    void fetchCourts(false);
  }, [fetchCourts]);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const unsubscribe = apiClient.current.subscribeToCourtUpdates({
        onOpen: () => {
          if (!isMountedRef.current || cancelled) return;
          setCourtsError("");
        },
        onMessage: (message) => {
          if (!isMountedRef.current || cancelled) return;
          if (!isCourtStatusUpdate(message)) return;

          void fetchCourts(true);
        },
        onError: (err) => {
          if (!isMountedRef.current || cancelled) return;

          if (courts.length === 0) {
            setCourtsError(err.message || "Live updates disconnected.");
          }

          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            if (cancelled) return;

            if (streamUnsubscribeRef.current) {
              streamUnsubscribeRef.current();
              streamUnsubscribeRef.current = null;
            }

            connect();
          }, 1500);
        },
      });

      streamUnsubscribeRef.current = () => {
        unsubscribe();
        clearReconnectTimer();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (streamUnsubscribeRef.current) {
        streamUnsubscribeRef.current();
        streamUnsubscribeRef.current = null;
      }
      clearReconnectTimer();
    };
  }, [fetchCourts, courts.length, clearReconnectTimer]);

  const renderCourtsBody = () => {
    if ((courtsState === "idle" || courtsState === "loading") && courts.length === 0) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.subtle}>Loading courts…</Text>
        </View>
      );
    }

    if (courtsState === "error" && courts.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t load courts</Text>
          <Text style={styles.subtle}>{courtsError}</Text>
          <Pressable style={styles.button} onPress={() => void fetchCourts(false)}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        data={courts}
        keyExtractor={(item) => item.court_id}
        refreshControl={
          <RefreshControl
            refreshing={refreshingCourts}
            onRefresh={() => void fetchCourts(true)}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <CourtRow court={item} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.subtle}>
              {selectedLocation
                ? "No courts available for this location."
                : "Select a location first."}
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {activeTab === "locations" ? (
        <LocationsScreen
          locations={locations}
          selectedLocationId={selectedLocationId}
          loading={locationsState === "loading" || locationsState === "idle"}
          refreshing={refreshingLocations}
          errorMessage={locationsError || null}
          onSelectLocation={(location) => {
            setSelectedLocationId(location.id);
            setActiveTab("courts");
          }}
          onRefresh={() => void fetchLocations(true)}
          onRetry={() => void fetchLocations(false)}
          headerTitle="Locations"
        />
      ) : activeTab === "courts" ? (
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Courts</Text>
            <Text style={styles.subtitle}>
              {selectedLocation ? selectedLocation.name : "No location selected"}
            </Text>
          </View>
          {renderCourtsBody()}
        </View>
      ) : (
        <SettingsScreen />
      )}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { color: "#F8FAFC", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#94A3B8", marginTop: 4, fontSize: 14 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  subtle: { color: "#94A3B8", textAlign: "center" },
  errorTitle: { color: "#F8FAFC", fontSize: 18, fontWeight: "600" },
  button: {
    marginTop: 8,
    backgroundColor: "#2563EB",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "600" },
  listContent: { paddingHorizontal: 12, paddingBottom: 20 },
  emptyWrap: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
