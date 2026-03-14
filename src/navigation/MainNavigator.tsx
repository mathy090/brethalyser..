import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useOfficer } from "../context/OfficerContext";

import HomeScreen from "../screens/HomeScreen";
import PrintScreen from "../screens/PrintScreen";
import ServerScreen from "../screens/ServerScreen";
import SettingsScreen from "../screens/SettingsScreen";
import DashboardScreen from "../screens/DashboardScreen";

const Tab = createBottomTabNavigator();

const Icon = ({ label, color }: { label: string; color: string }) => (
  <Text style={{ fontSize: 20, color }}>{label}</Text>
);

function LockedScreen() {
  return (
    <View style={locked.container}>
      <Text style={locked.icon}>🔒</Text>
      <Text style={locked.title}>Access Restricted</Text>
      <Text style={locked.sub}>
        Your account is pending approval. This feature will unlock once approved.
      </Text>
    </View>
  );
}

const locked = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", justifyContent: "center", alignItems: "center", padding: 30 },
  icon: { fontSize: 48, marginBottom: 20 },
  title: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 10 },
  sub: { color: "#666", fontSize: 14, textAlign: "center", lineHeight: 22 },
});

export default function MainNavigator() {
  const { officer } = useOfficer();

  const role = officer?.role ?? "officer";
  const status = officer?.status ?? "pending";

  const isApproved = status === "approved";
  const isAdmin = role === "admin" || role === "superadmin";
  const isSuperAdmin = role === "superadmin";

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#1DB954",
        tabBarInactiveTintColor: "rgba(255,255,255,0.4)",
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => <View style={styles.tabBarBg} />,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: ({ color }) => <Icon label="⌂" color={color} /> }}
      />

      <Tab.Screen
        name="Print"
        component={isApproved ? PrintScreen : LockedScreen}
        options={{ tabBarIcon: ({ color }) => <Icon label="⎙" color={color} /> }}
      />

      {isAdmin && (
        <Tab.Screen
          name="Server"
          component={ServerScreen}
          options={{ tabBarIcon: ({ color }) => <Icon label="⬡" color={color} /> }}
        />
      )}

      {isSuperAdmin && (
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ tabBarIcon: ({ color }) => <Icon label="◈" color={color} /> }}
        />
      )}

      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: ({ color }) => <Icon label="⚙" color={color} /> }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    borderRadius: 30,
    height: 70,
    borderTopWidth: 0,
    elevation: 0,
    backgroundColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  tabBarBg: {
    flex: 1,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "rgba(18,18,18,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  label: { fontSize: 11, fontWeight: "600", marginBottom: 6 },
});