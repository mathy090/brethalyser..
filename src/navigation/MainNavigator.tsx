import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useOfficer } from "../context/OfficerContext";

import HomeScreen        from "../screens/HomeScreen";
import BreathalyserScreen from "../screens/BreathalyserScreen";
import ServerScreen      from "../screens/ServerScreen";
import SettingsScreen    from "../screens/SettingsScreen";
import DashboardScreen   from "../screens/DashboardScreen";
import RoleChangedScreen from "../screens/RoleChangedScreen";

const Tab = createBottomTabNavigator();

const Icon = ({ label, color }: { label: string; color: string }) => (
  <Text style={{ fontSize: 20, color }}>{label}</Text>
);

export default function MainNavigator() {
  const { officer, roleChanged } = useOfficer();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [officer?.role]);

  if (roleChanged) {
    return <RoleChangedScreen />;
  }

  const role        = officer?.role ?? "officer";
  const isAdmin     = role === "admin" || role === "superadmin";
  const isSuperAdmin = role === "superadmin";

  return (
    <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
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
          options={{
            tabBarLabel: "Home",
            tabBarIcon: ({ color }) => <Icon label="⌂" color={color} />,
          }}
        />

        <Tab.Screen
          name="Breathalyser"
          component={BreathalyserScreen}
          options={{
            tabBarLabel: "Breathalyser",
            tabBarIcon: ({ color }) => <Icon label="◉" color={color} />,
          }}
        />

        {isAdmin && (
          <Tab.Screen
            name="Server"
            component={ServerScreen}
            options={{
              tabBarLabel: "Server",
              tabBarIcon: ({ color }) => <Icon label="⬡" color={color} />,
            }}
          />
        )}

        {isSuperAdmin && (
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{
              tabBarLabel: "Dashboard",
              tabBarIcon: ({ color }) => <Icon label="◈" color={color} />,
            }}
          />
        )}

        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: "Settings",
            tabBarIcon: ({ color }) => <Icon label="⚙" color={color} />,
          }}
        />
      </Tab.Navigator>
    </Animated.View>
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