import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function MainScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome, Officer</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    justifyContent: "center",
    alignItems: "center",
  },
  welcome: {
    color: "#1DB954",
    fontSize: 26,
    fontWeight: "bold",
  },
});