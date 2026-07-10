import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "primeicons/primeicons.css";
import "./styles.css";

/** Vercel 风格的黑白主色 PrimeVue 主题。 */
const consolePreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{zinc.50}",
      100: "{zinc.100}",
      200: "{zinc.200}",
      300: "{zinc.300}",
      400: "{zinc.400}",
      500: "{zinc.500}",
      600: "{zinc.600}",
      700: "{zinc.700}",
      800: "{zinc.800}",
      900: "{zinc.900}",
      950: "{zinc.950}",
    },
    colorScheme: {
      light: {
        primary: {
          color: "{zinc.950}",
          inverseColor: "#ffffff",
          hoverColor: "{zinc.800}",
          activeColor: "{zinc.700}",
        },
        highlight: {
          background: "{zinc.950}",
          focusBackground: "{zinc.800}",
          color: "#ffffff",
          focusColor: "#ffffff",
        },
      },
    },
  },
});

const app = createApp(App);

app.use(PrimeVue, {
  ripple: false,
  theme: {
    preset: consolePreset,
    options: {
      darkModeSelector: ".dark",
      cssLayer: false,
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(router);
app.mount("#app");
