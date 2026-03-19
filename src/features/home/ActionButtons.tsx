import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function ActionButtons() {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.btn}>
        <Text style={styles.text}>Scan</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn}>
        <Text style={styles.text}>Upload</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btn}>
        <Text style={styles.text}>Print</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  btn: {
    flex: 1,
    backgroundColor: "#1DB954",
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 4,
    alignItems: "center",
  },
  text: {
    color: "#000",
    fontWeight: "bold",
  },
});