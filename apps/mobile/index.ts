// IMPORTANT: this polyfill must load before amazon-cognito-identity-js so that
// crypto.getRandomValues() exists for the SRP sign-in handshake on React Native.
import "react-native-get-random-values";
// Installs global TextEncoder/TextDecoder before postal-mime is loaded, so opening
// an email can parse its raw .eml on Hermes. Must precede `import App`.
import "./src/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
