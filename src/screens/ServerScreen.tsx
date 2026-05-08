// src/screens/ServerScreen.tsx
// Record viewer – displays all uploaded driver + BAC records.
// Tap a photo to enlarge, tap a card to expand and read full non‑editable
// licence details. Data is fetched from GET /api/records (Supabase).

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BACKEND_URL } from "@env";
import { useLiveClock } from "../hooks/useLiveClock";            // optional
import { useNetworkStatus } from "../helpers/network";          // optional

// ─── Types ───────────────────────────────────────────────────────────────────
type RecordItem = {
  id: string;              // driver DB id (from Supabase)
  first_name: string;
  surname: string;
  id_number: string;
  licence_number: string;
  date_of_birth: string;
  gender: string;
  licence_code: string;
  issue_date: string;
  expiry_date: string;
  photo_url: string;       // public URL from Supabase Storage
  bac_value: number;
  fine_amount: number;
  over_limit: boolean;
  recorded_at: string;     // ISO timestamp of the BAC reading
  officer_id: string;
};

const RECORDS_URL = `${BACKEND_URL}/api/records`; // adjust if your route differs

export default function ServerScreen() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(RECORDS_URL);
      const data = await response.json();
      if (response.ok) {
        setRecords(data.records);
      } else {
        Alert.alert("Error", data.message || "Could not load records");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to fetch records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  // ── Render a single record card ────────────────────────────────────────────
  const renderCard = ({ item }: { item: RecordItem }) => {
    const isExpanded = expandedId === item.id;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <TouchableOpacity
            onPress={() => setSelectedImage(item.photo_url)}
            style={styles.thumbnailWrap}
          >
            <Image source={{ uri: item.photo_url }} style={styles.thumbnail} />
          </TouchableOpacity>

          <View style={styles.cardInfo}>
            <Text style={styles.name}>
              {item.first_name} {item.surname}
            </Text>

            <View style={styles.bacRow}>
              <Text
                style={[
                  styles.bacValue,
                  { color: item.over_limit ? "#FF4C4C" : "#1DB954" },
                ]}
              >
                {item.bac_value.toFixed(3)}%
              </Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.fine}>Fine ${item.fine_amount}</Text>
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.time}>
                {new Date(item.recorded_at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              <Text
                style={[
                  styles.overLimitLabel,
                  { color: item.over_limit ? "#FF4C4C" : "#1DB954" },
                ]}
              >
                {item.over_limit ? "OVER LIMIT" : "PASS"}
              </Text>
            </View>
          </View>
        </View>

        {isExpanded && (
          <View style={styles.expandedDetails}>
            <DetailRow label="ID Number" value={item.id_number} />
            <DetailRow label="Licence No" value={item.licence_number} />
            <DetailRow label="DOB" value={item.date_of_birth} />
            <DetailRow label="Gender" value={item.gender} />
            <DetailRow label="Code" value={item.licence_code} />
            <DetailRow label="Issue" value={item.issue_date} />
            <DetailRow label="Expiry" value={item.expiry_date} />
            <DetailRow label="Officer ID" value={item.officer_id} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const screenWidth = Dimensions.get("window").width;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Top bar — simple title, consistent with app design */}
      <View style={styles.topBar}>
        <Text style={styles.title}>Records</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1DB954" />
        </View>
      ) : records.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No records uploaded yet.</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          renderItem={renderCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Full‑screen photo modal */}
      <Modal visible={!!selectedImage} transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setSelectedImage(null)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
          {selectedImage && (
            <Image
              source={{ uri: selectedImage }}
              style={[
                styles.fullImage,
                { width: screenWidth * 0.9, aspectRatio: 1.58 },
              ]}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Small helper component for read‑only detail rows ───────────────────────
const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value || "—"}</Text>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#121212",
  },
  topBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#555",
    fontSize: 14,
  },
  listContent: {
    padding: 12,
  },
  card: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  thumbnailWrap: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: "hidden",
    marginRight: 12,
    backgroundColor: "#000",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  cardInfo: {
    flex: 1,
  },
  name: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  bacRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  bacValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  dot: {
    color: "#666",
    marginHorizontal: 6,
  },
  fine: {
    color: "#888",
    fontSize: 13,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  time: {
    color: "#666",
    fontSize: 12,
  },
  overLimitLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 8,
  },
  expandedDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  detailLabel: {
    color: "#555",
    fontSize: 12,
  },
  detailValue: {
    color: "#ccc",
    fontSize: 12,
    textAlign: "right",
    maxWidth: "60%",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  closeButtonText: {
    color: "#fff",
    fontSize: 24,
  },
  fullImage: {
    borderRadius: 12,
  },
});