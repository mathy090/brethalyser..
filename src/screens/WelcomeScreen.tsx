import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ImageBackground } from "react-native";
import * as Animatable from "react-native-animatable";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AuthNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export default function WelcomeScreen({ navigation }: Props) {
  return (
    <ImageBackground
      source={require("../../assets/background.png")}
      style={styles.bg}
      blurRadius={10}
    >
      <View style={styles.overlay}>
        <Animatable.Text animation="fadeInDown" duration={900} style={styles.title}>
          Blow Safe
        </Animatable.Text>

        <Animatable.Text animation="fadeIn" delay={300} style={styles.subtitle}>
          Secure smart breathalyser platform for modern traffic enforcement.
        </Animatable.Text>

        <Animatable.View animation="fadeInUp" delay={500} style={styles.buttons}>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate("Login")}>
            <Text style={styles.btnText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate("Register")}>
            <Text style={styles.btnText}>Sign Up</Text>
          </TouchableOpacity>
        </Animatable.View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "space-evenly",
    paddingHorizontal: 30,
    paddingVertical: 80,
  },
  title: { fontSize: 36, fontWeight: "bold", color: "#1DB954", textAlign: "center" },
  subtitle: { color: "#b3b3b3", fontSize: 16, textAlign: "center", lineHeight: 24 },
  buttons: { gap: 14 },
  btn: {
    borderColor: "#1DB954",
    borderWidth: 1.5,
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#1DB954", fontSize: 16, fontWeight: "600" },
});