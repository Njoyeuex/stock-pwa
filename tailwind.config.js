/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        blink: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.45 },
        },
        "caisse-glow": {
          "0%, 100%": { opacity: 1, backgroundPosition: "0% 50%" },
          "50%": { opacity: 0.8, backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        blink: "blink 1s ease-in-out infinite",
        "caisse-glow": "caisse-glow 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
