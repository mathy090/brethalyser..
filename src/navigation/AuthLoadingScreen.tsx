import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

export default function AuthLoadingScreen({ route, navigation }: any) {

  const { email, password } = route.params;

  useEffect(() => {
    login();
  }, []);

  const login = async () => {
    try {

      const auth = getAuth();

      await signInWithEmailAndPassword(auth, email, password);

      navigation.replace("MainApp");

    } catch (err) {

      navigation.replace("Login", {
        error: "Invalid email or password"
      });

    }
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1DB954" />
      <Text style={styles.text}>Retrieving credentials...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{
    flex:1,
    backgroundColor:"#121212",
    justifyContent:"center",
    alignItems:"center"
  },
  text:{
    color:"#fff",
    marginTop:20
  }
});