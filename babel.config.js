module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    "@babel/plugin-syntax-flow",
    [
      "module:react-native-dotenv",
      {
        moduleName: "@env",
        path: ".env",
        allowUndefined: true
      }
    ]
  ]
};