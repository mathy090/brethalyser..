import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import WelcomeScreen from "../screens/WelcomeScreen";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import MainScreen from "../screens/MainScreen";

export type RootStackParamList = {
  Welcome: undefined;
  Login: { error?: string } | undefined;
  Register: undefined;
  MainApp: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="MainApp" component={MainScreen} />
    </Stack.Navigator>
  );
}