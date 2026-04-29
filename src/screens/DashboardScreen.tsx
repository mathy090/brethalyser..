/**
 * src/screens/DashboardScreen.tsx
 * Admin dashboard for managing officers - role/status toggles + import
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  TouchableWithoutFeedback,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useOfficer } from "../context/OfficerContext";
import { logoutOfficer } from "../auth/authService";
import { getAuthToken } from "../auth/authService";
import { io, Socket } from "socket.io-client";
import axios from "axios";
import { env } from "../config/env"; // Your base API URL config

// Types
type Officer = {
  _id: string;
  officerId: string;
  email: string;
  firebaseUid: string;
  role: "officer" | "admin" | "superadmin";
  status: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  createdAt: string;
};

type DropdownState = { id: string; field: "role" | "status" } | null;

const API_BASE = env.API_URL || "http://localhost:5000/api";
const VALID_ROLES = ["officer", "admin", "superadmin"] as const;
const VALID_STATUSES = ["approved", "rejected"] as const; // Simplified for UI

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { officer: currentOfficer, clearOfficer, acknowledgeRoleChange } = useOfficer();
  
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [newOfficerId, setNewOfficerId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState<DropdownState>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // ─── Socket Setup: Listen for roleUpdate events ───────────────────────────
  useEffect(() => {
    const socketInstance = io(env.API_URL || "http://localhost:5000", {
      transports: ["websocket"],
      autoConnect: true,
    });

    socketInstance.on("connect", () => {
      console.log("✅ Socket connected");
      // Join private room using firebaseUid for targeted updates
      if (currentOfficer?.firebaseUid) {
        socketInstance.emit("join", currentOfficer.firebaseUid);
      }
    });

    socketInstance.on("roleUpdate", (data: { role: string; status: string }) => {
      console.log("🔔 Role update received:", data);
      // Trigger the freeze + relogin flow
      acknowledgeRoleChange();
      Alert.alert(
        "Access Updated",
        "Your permissions have changed. Please sign in again.",
        [
          {
            text: "Sign In",
            onPress: async () => {
              await logoutOfficer();
              await clearOfficer();
              navigation.replace("Login");
            },
          },
        ]
      );
    });

    socketInstance.on("connect_error", (err) => {
      console.error("Socket error:", err);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [currentOfficer?.firebaseUid]);

  // Re-join room if firebaseUid changes
  useEffect(() => {
    if (socket && currentOfficer?.firebaseUid) {
      socket.emit("join", currentOfficer.firebaseUid);
    }
  }, [socket, currentOfficer?.firebaseUid]);

  // ─── Fetch Officers ────────────────────────────────────────────────────────
  const fetchOfficers = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getAuthToken();
      const response = await axios.get(`${API_BASE}/admin/officers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOfficers(response.data);
    } catch (error) {
      console.error("Failed to fetch officers:", error);
      Alert.alert("Error", "Could not load officers list");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOfficers();
  }, [fetchOfficers]);

  // ─── Pull-to-Refresh ───────────────────────────────────────────────────────
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOfficers();
  }, [fetchOfficers]);

  // ─── Optimistic Update Helper ─────────────────────────────────────────────
  const updateOfficerOptimistic = async (
    id: string,
    field: "role" | "status",
    newValue: string
  ) => {
    const original = officers.find((o) => o._id === id);
    if (!original) return;

    // 1. Optimistic UI update
    setOfficers((prev) =>
      prev.map((o) => (o._id === id ? { ...o, [field]: newValue } : o))
    );

    try {
      const token = await getAuthToken();
      const endpoint =
        field === "role"
          ? `${API_BASE}/admin/officers/${id}/role`
          : `${API_BASE}/admin/officers/${id}/status`;

      await axios.patch(
        endpoint,
        { [field]: newValue },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      // 2. Rollback on error
      console.error("Update failed, rolling back:", error);
      Alert.alert("Update failed", "Changes reverted due to error");
      setOfficers((prev) =>
        prev.map((o) =>
          o._id === id ? { ...o, [field]: original[field] } : o
        )
      );
    }
  };

  // ─── Import Officer (Minimal Form) ────────────────────────────────────────
  const handleImport = async () => {
    if (!newOfficerId.trim() || !newEmail.trim()) {
      Alert.alert("Missing fields", "Please enter both Officer ID and Email");
      return;
    }

    try {
      await axios.post(`${API_BASE}/admin/officers/import`, {
        officers: [
          {
            officerId: newOfficerId.trim(),
            email: newEmail.trim().toLowerCase(),
          },
        ],
      });

      Alert.alert("Success", "Officer added with pending status");
      setImportModal(false);
      setNewOfficerId("");
      setNewEmail("");
      fetchOfficers(); // Refresh list
    } catch (error) {
      console.error("Import failed:", error);
      Alert.alert("Error", "Failed to add officer");
    }
  };

  // ─── Dropdown Item Component ──────────────────────────────────────────────
  const renderDropdownItem = (
    value: string,
    selected: string,
    onPress: () => void
  ) => (
    <TouchableOpacity style={styles.dropdownItem} onPress={onPress}>
      <Text
        style={[
          styles.dropdownItemText,
          selected === value && styles.dropdownItemSelected,
        ]}
      >
        {value}
      </Text>
    </TouchableOpacity>
  );

  // ─── Officer Card with Inline Dropdowns ───────────────────────────────────
  const renderOfficerCard = ({ item }: { item: Officer }) => {
    const isDropdownOpen = dropdownOpen?.id === item._id;
    const dropdownField = dropdownOpen?.field;

    return (
      <View style={styles.card}>
        {/* Header: ID + Email + Status Badge */}
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.officerId}>{item.officerId}</Text>
            <Text style={styles.email}>{item.email}</Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  item.status === "approved"
                    ? "#1DB954"
                    : item.status === "rejected"
                    ? "#FF4444"
                    : "#FFA500",
              },
            ]}
          >
            <Text style={styles.statusBadgeText}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Controls: Role + Status Dropdowns */}
        <View style={styles.controlsRow}>
          {/* Role Dropdown */}
          <View style={styles.dropdown}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() =>
                setDropdownOpen(
                  isDropdownOpen && dropdownField === "role"
                    ? null
                    : { id: item._id, field: "role" }
                )
              }
            >
              <Text style={styles.dropdownLabel}>Role:</Text>
              <Text style={styles.dropdownValue}>{item.role}</Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </TouchableOpacity>

            {isDropdownOpen && dropdownField === "role" && (
              <View style={styles.dropdownMenu}>
                {VALID_ROLES.map((role) =>
                  renderDropdownItem(role, item.role, () => {
                    setDropdownOpen(null);
                    if (item.role !== role) {
                      updateOfficerOptimistic(item._id, "role", role);
                    }
                  })
                )}
              </View>
            )}
          </View>

          {/* Status Dropdown */}
          <View style={styles.dropdown}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() =>
                setDropdownOpen(
                  isDropdownOpen && dropdownField === "status"
                    ? null
                    : { id: item._id, field: "status" }
                )
              }
            >
              <Text style={styles.dropdownLabel}>Status:</Text>
              <Text style={styles.dropdownValue}>{item.status}</Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </TouchableOpacity>

            {isDropdownOpen && dropdownField === "status" && (
              <View style={styles.dropdownMenu}>
                {VALID_STATUSES.map((status) =>
                  renderDropdownItem(status, item.status, () => {
                    setDropdownOpen(null);
                    if (item.status !== status) {
                      updateOfficerOptimistic(item._id, "status", status);
                    }
                  })
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  // ─── Import Modal ─────────────────────────────────────────────────────────
  const renderImportModal = () => (
    <Modal
      visible={importModal}
      animationType="slide"
      transparent
      onRequestClose={() => setImportModal(false)}
    >
      <TouchableWithoutFeedback onPress={() => setImportModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Officer</Text>

              <TextInput
                style={styles.input}
                placeholder="Officer ID"
                placeholderTextColor="#666"
                value={newOfficerId}
                onChangeText={setNewOfficerId}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#666"
                value={newEmail}
                onChangeText={setNewEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => {
                    setImportModal(false);
                    setNewOfficerId("");
                    setNewEmail("");
                  }}
                >
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={handleImport}
                >
                  <Text style={styles.btnPrimaryText}>Add Officer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  // ─── Loading State ────────────────────────────────────────────────────────
  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>Loading officers...</Text>
      </View>
    );
  }

  // ─── Main Render ──────────────────────────────────────────────────────────
  return (
    <TouchableWithoutFeedback onPress={() => setDropdownOpen(null)}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Officer Management</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setImportModal(true)}
          >
            <Text style={styles.addButtonText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Officers List */}
        <FlatList
          data={officers}
          renderItem={renderOfficerCard}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#1DB954"
            />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No officers found.</Text>
          }
        />

        {/* Import Modal */}
        {renderImportModal()}
      </View>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles (Dark Theme Matching RoleChangedScreen) ─────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#888",
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#1E1E1E",
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A2A",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  addButton: {
    backgroundColor: "#1DB954",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: "#1E1E1E",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  officerId: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  email: {
    color: "#888",
    fontSize: 14,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#2A2A2A",
    paddingTop: 12,
  },
  dropdown: {
    position: "relative",
    minWidth: 110,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    backgroundColor: "#2A2A2A",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3A3A3A",
  },
  dropdownLabel: {
    color: "#666",
    fontSize: 11,
    marginRight: 4,
  },
  dropdownValue: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  dropdownArrow: {
    color: "#666",
    fontSize: 9,
  },
  dropdownMenu: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#1E1E1E",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3A3A3A",
    marginTop: 4,
    zIndex: 100,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A2A",
  },
  dropdownItemText: {
    color: "#ccc",
    fontSize: 14,
  },
  dropdownItemSelected: {
    color: "#1DB954",
    fontWeight: "bold",
  },
  emptyText: {
    textAlign: "center",
    color: "#666",
    marginTop: 40,
    fontSize: 14,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    backgroundColor: "#1E1E1E",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#333",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#2A2A2A",
    color: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#3A3A3A",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  btn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 6,
  },
  btnPrimary: {
    backgroundColor: "#1DB954",
  },
  btnPrimaryText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: "#333",
  },
  btnSecondaryText: {
    color: "#ccc",
    fontSize: 15,
  },
});