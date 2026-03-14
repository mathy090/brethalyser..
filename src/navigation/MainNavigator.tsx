import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { BlurView } from "@react-native-community/blur";

// Screens
import HomeScreen from "../screens/HomeScreen";
import PrintScreen from "../screens/PrintScreen";
import ServerScreen from "../screens/ServerScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

// ── Icons (pure SVG — no icon library needed) ─────────────────────────
const HomeIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 22, color }}>⌂</Text>
);
const PrintIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 22, color }}>⎙</Text>
);
const ServerIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 22, color }}>⬡</Text>
);
const SettingsIcon = ({ color }: { color: string }) => (
  <Text style={{ fontSize: 22, color }}>⚙</Text>
);

export default function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#1DB954",
        tabBarInactiveTintColor: "rgba(255,255,255,0.4)",
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => (
          <View style={styles.tabBarBackground} />
        ),
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Print"
        component={PrintScreen}
        options={{
          tabBarIcon: ({ color }) => <PrintIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Server"
        component={ServerScreen}
        options={{
          tabBarIcon: ({ color }) => <ServerIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
        }}
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
  tabBarBackground: {
    flex: 1,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "rgba(18,18,18,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
});